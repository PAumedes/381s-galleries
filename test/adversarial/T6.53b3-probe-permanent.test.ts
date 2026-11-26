import { expect, it } from "vitest";
import { runSync } from "../../app/lib/server/sync";
import { T0, after, e, mk, setup } from "./T6.53b-fix-helpers";

setup(true);

it("a quiet versioned album is skipped on the next unforced sync (probe not permanently true)", async () => {
  const drive = mk([
    ["hr", "A.jpg"],
    ["hr", "A_v2.jpg"],
  ]);
  await runSync(e, { drive, force: true, now: T0, budget: 200 });
  const r = await runSync(e, { drive, now: after(15), budget: 200 });
  expect(r.skipped).toBeDefined();
});

it("same with an empty album (no photos) and a photo with no web variant", async () => {
  const drive = mk([["hr", "Z.jpg"]]);
  await runSync(e, { drive, force: true, now: T0, budget: 200 });
  const r = await runSync(e, { drive, now: after(15), budget: 200 });
  expect(r.skipped).toBeDefined();
});
