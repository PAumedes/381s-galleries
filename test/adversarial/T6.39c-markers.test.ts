import { env } from "cloudflare:workers";
import { like } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";
import {
  fakeWarmDrive,
  seedGallery,
  seedPhotos,
  warmGalleryId,
} from "../support/warm";
import { putSetting, SETTINGS_KEYS } from "../../app/lib/server/settings";
import { warmPendingGalleries } from "../../app/lib/server/warm-after-sync";
import { deleteGallery } from "../../app/lib/server/gallery-delete";

const db = getDb(env);
const base = { ...env, DRIVE_MODE: "google" } as Env;
const P = SETTINGS_KEYS.warmPendingPrefix;
const markers = async () =>
  await db
    .select()
    .from(schema.settings)
    .where(like(schema.settings.key, P + "%"));
beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await resetTables("settings", "rate_limits", "ignored_folders");
  await clearCache();
});

describe("T6.39c markers", () => {
  it("a newer sync marking mid-pass is not lost", async () => {
    const g = warmGalleryId(1);
    await seedGallery(g);
    await seedPhotos(g, 2);
    await putSetting(base, P + g, "2026-01-01T00:00:00Z");
    const { drive } = fakeWarmDrive({
      hook: async () => {
        await putSetting(base, P + g, "2026-02-02T00:00:00Z");
      },
    });
    await warmPendingGalleries(base, drive, { d1Budget: 45 });
    const m = await markers();
    expect(m.map((x) => x.value)).toContain("2026-02-02T00:00:00Z");
  });

  it("a newer mark survives even when the walk fails (rotate CAS)", async () => {
    const g = warmGalleryId(1);
    await seedGallery(g);
    await seedPhotos(g, 2);
    await putSetting(base, P + g, "2026-01-01T00:00:00Z");
    const { drive } = fakeWarmDrive({
      fail: () => true,
      hook: async () => {
        await putSetting(base, P + g, "2026-02-02T00:00:00Z");
      },
    });
    await warmPendingGalleries(base, drive, { d1Budget: 45 });
    expect((await markers())[0].value).toBe("2026-02-02T00:00:00Z");
  });

  it("gallery deleted mid-warm leaves no marker or cursor", async () => {
    const g = warmGalleryId(1);
    await seedGallery(g);
    await seedPhotos(g, 3);
    await putSetting(base, P + g, "2026-01-01T00:00:00Z");
    let n = 0;
    const { drive } = fakeWarmDrive({
      hook: async () => {
        if (++n === 1) expect(await deleteGallery(base, g)).toBe("deleted");
      },
    });
    await warmPendingGalleries(base, drive, { d1Budget: 45 });
    const rows = await db.select().from(schema.settings);
    expect(rows.filter((r) => r.key.includes(g))).toEqual([]);
  });

  it("real delete removes the marker", async () => {
    const g = warmGalleryId(1);
    await seedGallery(g);
    await putSetting(base, P + g, "2026-01-01T00:00:00Z");
    expect(await deleteGallery(base, g)).toBe("deleted");
    expect(await markers()).toEqual([]);
  });

  it("5 failing galleries: every one gets a turn within 3 runs", async () => {
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const g = warmGalleryId(i, "b");
      ids.push(g);
      await seedGallery(g);
      await seedPhotos(g, 2);
      await putSetting(base, P + g, "2026-01-0" + i + "T00:00:00Z");
    }
    const seen = new Set<string>();
    for (let run = 0; run < 3; run++) {
      await resetTables("rate_limits");
      const { drive, calls } = fakeWarmDrive({ fail: () => true });
      await warmPendingGalleries(base, drive, { d1Budget: 45 });
      for (const c of calls) seen.add(c.slice(-7, -4));
    }
    expect(seen.size).toBe(5);
  });
});
