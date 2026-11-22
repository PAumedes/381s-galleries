import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";
import {
  fakeWarmDrive,
  photoId,
  seedGallery,
  seedPhotos,
  warmGalleryId,
} from "../support/warm";
import { putSetting, SETTINGS_KEYS } from "../../app/lib/server/settings";
import { warmPendingGalleries } from "../../app/lib/server/warm-after-sync";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "google" } as Env;
beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await resetTables("settings", "rate_limits");
  await clearCache();
});

describe("T6.39b pending marker starvation", () => {
  it("three galleries with a permanently missing file do not starve a newer marked gallery", async () => {
    const bad = [1, 2, 3].map((n) => warmGalleryId(n));
    const good = warmGalleryId(4);
    for (const g of [...bad, good]) {
      await seedGallery(g);
      await seedPhotos(g, 2);
    }
    for (const [i, g] of [...bad, good].entries())
      await putSetting(
        e,
        SETTINGS_KEYS.warmPendingPrefix + g,
        `2026-01-0${i + 1}T00:00:00Z`,
      );
    const broken = new Set(bad.map((g) => "HI-" + photoId(g, 0)));
    const { drive, calls } = fakeWarmDrive({
      fail: (id) =>
        broken.has(id) || bad.some((g) => id.endsWith(photoId(g, 0))),
    });
    for (let i = 0; i < 3; i++) await warmPendingGalleries(e, drive);
    expect(calls.some((c) => c.includes(photoId(good, 0)))).toBe(true);
  });
});
