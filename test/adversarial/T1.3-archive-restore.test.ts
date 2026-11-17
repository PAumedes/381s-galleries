import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema } from "../../app/db";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import type { DriveClient } from "../../app/lib/server/drive-types";
import { runSync } from "../../app/lib/server/sync";
import { db, e, galleryBy, ROOT, setup } from "./T1.3-helpers";

setup();

describe("T1.3 archive is a one-way, lossy trap", () => {
  it("a transient empty root listing archives every gallery and they never come back", async () => {
    const inner = createMockDrive();
    await runSync(e, { drive: inner });
    const g0 = await galleryBy("retrato-sofia");
    expect(g0.status).toBe("published");
    let blind = true;
    const flaky: DriveClient = {
      ...inner,
      subrequests: () => inner.subrequests(),
      getMeta: (id) => inner.getMeta(id),
      listChildrenMany: async (ids) => {
        const r = await inner.listChildrenMany(ids);
        if (blind && ids.length === 1 && ids[0] === ROOT()) r.set(ROOT(), []);
        return r;
      },
    };
    await runSync(e, { drive: flaky, force: true });
    // empty root listing aborts the sync: nothing is archived
    expect((await galleryBy("retrato-sofia")).status).toBe("published");
    blind = false;
    await runSync(e, { drive: flaky, force: true });
    // folder is back and live; gallery must not stay archived
    expect((await galleryBy("retrato-sofia")).status).toBe("published");
  });

  // Skipped by decision: only sync-archived galleries (archived_by_sync=1) are
  // restored; the assertion below is the old inverted expectation. The new
  // behaviour is covered by T4.2-sync-clobbers-admin.test.ts.
  it.skip("trashed then restored album stays archived", async () => {
    const inner = createMockDrive();
    await runSync(e, { drive: inner });
    await db
      .update(schema.galleries)
      .set({ status: "archived" })
      .where(eq(schema.galleries.slug, "retrato-sofia"));
    await runSync(e, { drive: inner, force: true }); // folder is present and live
    expect((await galleryBy("retrato-sofia")).status).not.toBe("archived");
  });
});
