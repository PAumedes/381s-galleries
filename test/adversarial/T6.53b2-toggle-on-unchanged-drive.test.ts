import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "../../app/db";
import { runSync } from "../../app/lib/server/sync";
import {
  GID,
  T0,
  after,
  db,
  e,
  mk,
  setup,
  versions,
} from "./T6.53b-fix-helpers";

setup(false);

// The admin message says "they are read at the next sync", the hint "the first
// sync after switching this on re-reads the versions".
it("after switching versioning on, the NEXT (non-forced) sync reads the versions even if Drive reported no change", async () => {
  const files: [string, string][] = [
    ["hr", "A.jpg"],
    ["hr", "A_v2.jpg"],
  ];
  const drive = mk(files);
  await runSync(e, { drive, now: T0, budget: 200 });
  await db
    .update(schema.galleries)
    .set({ versioning: true })
    .where(eq(schema.galleries.id, GID));
  const r = await runSync(e, { drive, now: after(15), budget: 200 });
  expect(r.skipped).toBeUndefined();
  expect((await versions()).some((v) => v.version === 2)).toBe(true);
});
