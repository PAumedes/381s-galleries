import { describe, expect, it } from "vitest";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { DriveError } from "../../app/lib/server/drive-types";
import type { DriveClient } from "../../app/lib/server/drive-types";
import { runSync } from "../../app/lib/server/sync";
import { e, setup } from "./T1.3-helpers";

setup();

describe("T1.3 changes token errors", () => {
  for (const status of [401, 403, 429]) {
    it(`listChanges ${status} must not be treated as a stale token (forces a full rescan)`, async () => {
      const inner = createMockDrive();
      await runSync(e, { drive: inner });
      let scanned = 0;
      const d: DriveClient = {
        ...inner,
        subrequests: () => inner.subrequests(),
        getMeta: (id) => {
          scanned++;
          return inner.getMeta(id);
        },
        listChildrenMany: (ids) => inner.listChildrenMany(ids),
        listChanges: async () => {
          throw new DriveError(status, "nope");
        },
      };
      await runSync(e, { drive: d }).catch(() => undefined);
      expect(scanned).toBe(0);
    });
  }
});
