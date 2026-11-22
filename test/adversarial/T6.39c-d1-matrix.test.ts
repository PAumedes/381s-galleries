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
  photoId,
} from "../support/warm";
import {
  warmGalleryAtPublish,
  warmGalleryOnOpen,
} from "../../app/lib/server/gallery-warm";
import {
  OPEN_WARM_D1_BUDGET,
  PUBLISH_WARM_D1_BUDGET,
} from "../../app/lib/server/d1-limits";
import { putSetting, SETTINGS_KEYS } from "../../app/lib/server/settings";
import { warmPendingGalleries } from "../../app/lib/server/warm-after-sync";

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

const modes = ["delivery", "proofing"] as const;
const fails = [
  ["none", () => false],
  ["all", () => true],
  ["every3", (id: string) => id.length % 3 === 0],
  ["highres", (id: string) => id.startsWith("HI-")],
] as const;

describe("T6.39c D1 matrix", () => {
  for (const mode of modes)
    for (const [fname, fail] of fails)
      for (const n of [1, 3, 40]) {
        it(`open ${mode} ${fname} n=${n}`, async () => {
          const g = warmGalleryId(1);
          await seedGallery(g, { mode });
          await seedPhotos(g, n);
          const { e, count } = countingEnv(base);
          const { drive } = fakeWarmDrive({ fail });
          await warmGalleryOnOpen(e, drive, "s-" + g.slice(-3));
          expect(count()).toBeLessThanOrEqual(OPEN_WARM_D1_BUDGET);
        });
        it(`publish ${mode} ${fname} n=${n} (cover set)`, async () => {
          const g = warmGalleryId(2);
          await seedGallery(g, { mode });
          await seedPhotos(g, n);
          if (n > 2)
            await db.update(schema.galleries).set({
              coverPhotoId: photoId(g, 1),
              coverPhotoIdMobile: photoId(g, 2),
            });
          const { e, count } = countingEnv(base);
          const { drive } = fakeWarmDrive({ fail });
          await warmGalleryAtPublish(e, drive, g);
          expect(count()).toBeLessThanOrEqual(PUBLISH_WARM_D1_BUDGET);
        });
        it(`pending ${mode} ${fname} n=${n} x4`, async () => {
          for (let i = 1; i <= 4; i++) {
            const g = warmGalleryId(i, "b");
            await seedGallery(g, { mode });
            await seedPhotos(g, n);
            await putSetting(
              base,
              SETTINGS_KEYS.warmPendingPrefix + g,
              "2026-01-0" + i,
            );
          }
          const { e, count } = countingEnv(base);
          const { drive } = fakeWarmDrive({ fail });
          await warmPendingGalleries(e, drive, { d1Budget: 30 });
          expect(count()).toBeLessThanOrEqual(30);
        });
      }
});
