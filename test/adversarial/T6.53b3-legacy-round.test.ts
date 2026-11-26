import { expect, it } from "vitest";
import { runSync } from "../../app/lib/server/sync";
import {
  GID,
  T0,
  after,
  db,
  e,
  mk,
  setup,
  rounds,
  versions,
} from "./T6.53b-fix-helpers";
import { schema } from "../../app/db";

setup(true);

// Decision: no production rows exist before T6.53b2; legacy NULL folder_round rounds are not backfilled (PLAN T6.53b)
it.skip("a round delivered by a v2/ folder BEFORE migration 0023 (folder_round NULL) takes a new file of the same v2/ folder, not a new round", async () => {
  const base: [string, string][] = [
    ["hr", "A.jpg"],
    ["hr", "B.jpg"],
    ["r2hr", "A.jpg"],
  ];
  await runSync(e, { drive: mk(base), force: true, now: T0, budget: 200 });
  // simulate the migrated state: 0022 rows get folder_round NULL
  const { sql } = await import("drizzle-orm");
  await db.run(sql`update delivery_rounds set folder_round = NULL`);
  expect((await rounds()).length).toBe(1);
  await runSync(e, {
    drive: mk([...base, ["r2hr", "B.jpg"]]),
    force: true,
    now: after(300),
    budget: 200,
  });
  expect((await rounds()).map((r) => r.number)).toEqual([2]);
  const v2 = (await versions()).filter((v) => v.version === 2);
  expect(new Set(v2.map((v) => v.roundId)).size).toBe(1);
});

// Decision: no production rows exist before T6.53b2; legacy NULL folder_round rounds are not backfilled (PLAN T6.53b)
it.skip("a legacy folder round (NULL) is not joined by a suffix delivery inside the 60 min window", async () => {
  const base: [string, string][] = [
    ["hr", "A.jpg"],
    ["hr", "B.jpg"],
    ["r2hr", "A.jpg"],
  ];
  await runSync(e, { drive: mk(base), force: true, now: T0, budget: 200 });
  const { sql } = await import("drizzle-orm");
  await db.run(sql`update delivery_rounds set folder_round = NULL`);
  await runSync(e, {
    drive: mk([...base, ["hr", "B_v2.jpg"]]),
    force: true,
    now: after(5),
    budget: 200,
  });
  const b = (await versions()).filter((v) => v.version === 2);
  const aRound = b.find((v) => v.driveHighresId.includes("r2hr"))?.roundId;
  const bRound = b.find((v) => v.driveHighresId.includes("B_v2"))?.roundId;
  expect(bRound).not.toBe(aRound);
  void GID;
  void schema;
});
