import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";
import {
  countingEnv,
  fakeWarmDrive,
  seedGallery,
  seedPhotos,
  warmGalleryId,
} from "../support/warm";
import { putSetting, SETTINGS_KEYS } from "../../app/lib/server/settings";
import { runWarmCron } from "../../app/lib/server/warm-after-sync";

const db = getDb(env);
const base = { ...env, DRIVE_MODE: "google" } as Env;
beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await resetTables("settings", "rate_limits");
  await clearCache();
});

describe("T6.39c cron D1", () => {
  for (const mode of ["delivery", "proofing"] as const)
    for (const [name, fail] of [
      ["ok", () => false],
      ["fail", () => true],
    ] as const)
      for (const marked of [0, 4])
        it(`cron ${mode} ${name} marked=${marked} <= 45`, async () => {
          for (let i = 1; i <= 4; i++) {
            const g = warmGalleryId(i, "c");
            await seedGallery(g, { mode });
            await seedPhotos(g, marked ? 0 : 30);
            if (marked) {
              await seedPhotos(g, 20);
              await putSetting(
                base,
                SETTINGS_KEYS.warmPendingPrefix + g,
                "2026-01-0" + i,
              );
            }
          }
          if (marked)
            // make the stale scan empty first
            await runWarmCron(base, fakeWarmDrive().drive);
          await resetTables("rate_limits");
          const { e, count } = countingEnv(base);
          await runWarmCron(e, fakeWarmDrive({ fail }).drive);
          expect(count()).toBeLessThanOrEqual(45);
        });
});
