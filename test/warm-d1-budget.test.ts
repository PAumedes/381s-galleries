import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { galleryAction } from "../app/lib/server/admin-galleries";
import {
  OPEN_WARM_D1_BUDGET,
  PUBLISH_ACTION_D1_QUERIES,
  PUBLISH_WARM_D1_BUDGET,
  SLUG_LOADER_D1_QUERIES,
} from "../app/lib/server/d1-limits";
import {
  D1_FREE_QUERIES_PER_INVOCATION,
  INVOCATION_SAFETY,
} from "../app/lib/server/d1-limits";
import { putSetting, SETTINGS_KEYS } from "../app/lib/server/settings";
import { warmPendingGalleries } from "../app/lib/server/warm-after-sync";
import { loadGallery } from "../app/lib/server/gallery";
import {
  warmGalleryAtPublish,
  warmGalleryOnOpen,
} from "../app/lib/server/gallery-warm";
import { clearCache } from "./support/cache";
import { migrateDb, resetTables } from "./support/d1";
import {
  countingEnv,
  fakeWarmDrive,
  seedGallery,
  seedPhotos,
  warmGalleryId,
} from "./support/warm";

const db = getDb(env);
const base = { ...env, DRIVE_MODE: "google" } as Env;
const FREE = D1_FREE_QUERIES_PER_INVOCATION;

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await resetTables("settings", "rate_limits");
  await clearCache();
});

describe("T6.39b D1 allowance of warm-on-open and warm-at-publish", () => {
  it("the documented loader/action query counts cover the real ones", async () => {
    const g = warmGalleryId(1);
    await seedGallery(g, { status: "draft" });
    await seedPhotos(g, 12);
    const loader = countingEnv(base);
    await db.update(schema.galleries).set({ status: "published" });
    const res = await loadGallery(
      new Request("http://x.test/s-" + g.slice(-3), {
        headers: {
          "CF-Connecting-IP": "203.0.113.9",
          "Sec-Fetch-Mode": "navigate",
        },
      }),
      "s-" + g.slice(-3),
      loader.e,
    );
    expect(res.data.state).toBe("open");
    expect(loader.count()).toBeLessThanOrEqual(SLUG_LOADER_D1_QUERIES);

    await db.update(schema.galleries).set({ status: "draft" });
    const action = countingEnv({
      ...env,
      DRIVE_MODE: "mock",
      ALLOW_DEV_ADMIN: "1",
    } as Env);
    const form = new URLSearchParams({ intent: "status", to: "publish" });
    const r = await galleryAction(
      new Request("http://localhost/admin/g/" + g, {
        method: "POST",
        body: form,
      }),
      action.e,
      g,
    );
    expect(r.ok).toBe(true);
    expect(action.count()).toBeLessThanOrEqual(PUBLISH_ACTION_D1_QUERIES);
  });

  it("budgets are Free 50 minus safety minus the caller's own queries", () => {
    expect(OPEN_WARM_D1_BUDGET).toBe(
      FREE - INVOCATION_SAFETY - SLUG_LOADER_D1_QUERIES,
    );
    expect(PUBLISH_WARM_D1_BUDGET).toBe(
      FREE - INVOCATION_SAFETY - PUBLISH_ACTION_D1_QUERIES,
    );
  });

  it("open warm of 40 photos stops cleanly within its budget, cursor saved", async () => {
    const g = warmGalleryId(2);
    await seedGallery(g);
    await seedPhotos(g, 40);
    const { e, count } = countingEnv(base);
    const { drive } = fakeWarmDrive();
    const r = await warmGalleryOnOpen(e, drive, "s-" + g.slice(-3));
    expect(r.stopped).toBe("budget");
    expect(count()).toBeLessThanOrEqual(OPEN_WARM_D1_BUDGET);
    const cur = await db.select().from(schema.settings);
    expect(cur.some((s) => s.key.startsWith("warm_cursor"))).toBe(true);
  });

  it("publish warm of 40 photos stops cleanly within its budget", async () => {
    const g = warmGalleryId(3);
    await seedGallery(g);
    await seedPhotos(g, 40);
    const { e, count } = countingEnv(base);
    const { drive } = fakeWarmDrive();
    const r = await warmGalleryAtPublish(e, drive, g);
    expect(r.stopped).toBe("budget");
    expect(count()).toBeLessThanOrEqual(PUBLISH_WARM_D1_BUDGET);
  });

  it("the mode-switch Entrega->Prueba mid-warm still stops the unwatermarked fetch", async () => {
    const g = warmGalleryId(4);
    await seedGallery(g);
    await seedPhotos(g, 3);
    const { e } = countingEnv(base);
    let n = 0;
    const { drive, calls } = fakeWarmDrive({
      hook: async () => {
        if (++n === 1)
          await db.update(schema.galleries).set({ mode: "proofing" });
      },
    });
    await warmGalleryOnOpen(e, drive, "s-" + g.slice(-3));
    expect(calls.length).toBeLessThanOrEqual(1);
  });

  it("a marked gallery that ends not-done is rotated to the back (value = last attempt)", async () => {
    const g = warmGalleryId(5);
    await seedGallery(g);
    await seedPhotos(g, 2);
    const key = SETTINGS_KEYS.warmPendingPrefix + g;
    await putSetting(base, key, "2026-01-01T00:00:00Z");
    const { drive } = fakeWarmDrive({ fail: () => true });
    await warmPendingGalleries(base, drive);
    const [m] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, key));
    expect(m.value > "2026-06-01").toBe(true);
  });
});
