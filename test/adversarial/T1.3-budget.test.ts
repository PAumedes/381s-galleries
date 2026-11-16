import { describe, expect, it } from "vitest";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import type { DriveClient } from "../../app/lib/server/drive-types";
import { runSync } from "../../app/lib/server/sync";
import { e, setup } from "./T1.3-helpers";

setup();

// The real client counts every fetch, including changes/startPageToken
// (drive.ts#json). The mock does not, so wrap it to behave like the real one.
function realistic() {
  const inner = createMockDrive();
  let extra = 0;
  const d: DriveClient = {
    ...inner,
    subrequests: () => inner.subrequests() + extra,
    getMeta: (id) => inner.getMeta(id),
    listChildrenMany: (ids) => inner.listChildrenMany(ids),
    getStartPageToken: async () => {
      extra++;
      return inner.getStartPageToken();
    },
  };
  return d;
}

describe("T1.3 budget accounting", () => {
  it("total Drive subrequests of a run never exceed the budget (getStartPageToken is not counted by scan)", async () => {
    const d = realistic();
    let r;
    try {
      r = await runSync(e, { drive: d, force: true, budget: 5 });
    } catch {
      return; // throwing is acceptable
    }
    expect(d.subrequests()).toBeLessThanOrEqual(5);
    expect(r.subrequests).toBeLessThanOrEqual(5);
  });
});
