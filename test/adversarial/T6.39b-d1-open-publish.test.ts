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
import {
  warmGalleryAtPublish,
  warmGalleryOnOpen,
} from "../../app/lib/server/gallery-warm";

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

// The $slug loader's own queries (loadGallery: gallery, photos, views, ...) share the
// invocation's Free 50 D1 queries. Leave 12 for them.
const LOADER_RESERVE = 12;

describe("T6.39b D1 budget of the un-metered warms", () => {
  it("warm-on-open stays within 50 - loader queries", async () => {
    const g = warmGalleryId(1);
    await seedGallery(g);
    await seedPhotos(g, 40);
    const { e, count } = countingEnv(base);
    const { drive } = fakeWarmDrive();
    await warmGalleryOnOpen(e, drive, "s-" + g.slice(-3));
    expect(count()).toBeLessThanOrEqual(50 - LOADER_RESERVE);
  });

  it("warm-at-publish stays within 50 - admin action queries", async () => {
    const g = warmGalleryId(2);
    await seedGallery(g);
    await seedPhotos(g, 40);
    const { e, count } = countingEnv(base);
    const { drive } = fakeWarmDrive();
    await warmGalleryAtPublish(e, drive, g);
    expect(count()).toBeLessThanOrEqual(50 - LOADER_RESERVE);
  });
});
