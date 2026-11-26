import { expect, it } from "vitest";
import { runSync } from "../../app/lib/server/sync";
import { T0, after, e, mk, setup, versions } from "./T6.53b-fix-helpers";

setup(true);

it("a version row marked missingSince is deleted after the grace even when Drive reports no new change", async () => {
  const drive = mk([
    ["hr", "A.jpg"],
    ["hr", "A_v2.jpg"],
  ]);
  await runSync(e, { drive, now: T0, budget: 200 });
  drive.removeFile("hr/A_v2.jpg");
  await runSync(e, { drive, now: after(5), budget: 200 }); // marks missing
  expect((await versions()).find((v) => v.version === 2)).toBeDefined();
  // Cron keeps running, Drive is quiet: hasMaturingMissing only looks at photos/folders.
  await runSync(e, { drive, now: after(90), budget: 200 });
  expect((await versions()).find((v) => v.version === 2)).toBeUndefined();
});
