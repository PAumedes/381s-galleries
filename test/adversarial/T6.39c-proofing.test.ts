import { env } from "cloudflare:workers";
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
import {
  warmPendingGalleries,
  runWarmCron,
} from "../../app/lib/server/warm-after-sync";
import {
  warmGalleryAtPublish,
  warmGalleryOnOpen,
} from "../../app/lib/server/gallery-warm";

const db = getDb(env);
const base = { ...env, DRIVE_MODE: "google" } as Env;
const clean = (id: string) => !/^(WM|TWM)-/.test(id);
beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await resetTables("settings", "rate_limits");
  await clearCache();
});

async function setup(mode: "proofing" | "delivery", withWm = true) {
  const g = warmGalleryId(1);
  await seedGallery(g, { mode });
  await seedPhotos(g, 6, withWm);
  return g;
}

describe("T6.39c Prueba never fetches clean files", () => {
  for (const withWm of [true, false]) {
    it(`open/publish/pending/cron withWm=${withWm}`, async () => {
      const g = await setup("proofing", withWm);
      await putSetting(base, SETTINGS_KEYS.warmPendingPrefix + g, "2026-01-01");
      const a = fakeWarmDrive();
      await warmGalleryOnOpen(base, a.drive, "s-" + g.slice(-3));
      await resetTables("rate_limits");
      await warmGalleryAtPublish(base, a.drive, g);
      await resetTables("rate_limits");
      await warmPendingGalleries(base, a.drive);
      await resetTables("rate_limits");
      await runWarmCron(base, a.drive);
      expect(a.calls.filter(clean)).toEqual([]);
    });
  }
  for (const path of ["publish", "pending", "open", "cron"] as const)
    it(`switch to proofing mid-warm via ${path}`, async () => {
      const g = await setup("delivery");
      await putSetting(base, SETTINGS_KEYS.warmPendingPrefix + g, "2026-01-01");
      let n = 0;
      const { drive, calls } = fakeWarmDrive({
        hook: async () => {
          if (++n === 1)
            await db.update(schema.galleries).set({ mode: "proofing" });
        },
      });
      if (path === "publish") await warmGalleryAtPublish(base, drive, g);
      if (path === "pending") await warmPendingGalleries(base, drive);
      if (path === "open")
        await warmGalleryOnOpen(base, drive, "s-" + g.slice(-3));
      if (path === "cron") await runWarmCron(base, drive);
      // call 1 was in flight when the switch happened; nothing after it may be clean
      expect(calls.slice(1).filter(clean)).toEqual([]);
    });
});
