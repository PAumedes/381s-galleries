import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "../app/db";
import { OPEN_WARM_D1_BUDGET } from "../app/lib/server/d1-limits";
import { warmGalleryOnOpen } from "../app/lib/server/gallery-warm";
import {
  expectedWarmKey,
  warmBatch,
  warmCoverPhoto,
} from "../app/lib/server/warm";
import { staleRows } from "../app/lib/server/warm-stale";
import { clearCache } from "./support/cache";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv, fakeWarmDrive, noRatePrune } from "./support/warm";
import { files, modified, seedVersioned } from "./support/versions";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000e1";
const e = { ...env, DRIVE_MODE: "google" } as Env;

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables(
    "settings",
    "rate_limits",
    "photo_versions",
    "delivery_rounds",
    "photos",
    "galleries",
  );
  await clearCache();
  noRatePrune();
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "retoque",
    title: "Retoque",
    status: "published",
    versioning: true,
  });
  return () => vi.restoreAllMocks();
});
const keys = async () =>
  (await env.CACHE.list()).objects.map((o) => o.key).sort();

describe("T6.53c warm-on-open warms the latest version first", () => {
  it("fetches only the latest version's files, under their version-aware keys", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    await seedVersioned(G, "B", [{ n: 1 }], { sort: 1 });
    const { drive, calls } = fakeWarmDrive();
    const r = await warmGalleryOnOpen(e, drive, "retoque");
    expect(r.finished).toBe(true);
    expect(calls.sort()).toEqual(
      [
        "TH-A-v2",
        "WEB-A-v2",
        "HI-A-v2",
        "TH-B-v1",
        "WEB-B-v1",
        "HI-B-v1",
      ].sort(),
    );
    expect(await keys()).toEqual([
      "A/v2/thumb",
      "A/v2/view-lg",
      "A/v2/view-sm",
      "B/thumb",
      "B/view-lg",
      "B/view-sm",
    ]);
  });

  it("Prueba: warms the newest version that has a preview-wm (the one the visitor sees)", async () => {
    await db.update(schema.galleries).set({ mode: "proofing" });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }, { n: 3, wm: false }]);
    const { drive, calls } = fakeWarmDrive();
    await warmGalleryOnOpen(e, drive, "retoque");
    expect(calls.every((c) => c.endsWith("-A-v2") && /^T?WM-/.test(c))).toBe(
      true,
    );
    expect((await keys()).every((k) => k.startsWith("A/v2/"))).toBe(true);
  });

  it("marks the photo warmed with the key of what it fetched", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const { drive } = fakeWarmDrive();
    await warmGalleryOnOpen(e, drive, "retoque");
    const [row] = await db.select().from(schema.photos);
    const latest = {
      ...row,
      ...files("A", 2),
      variantVersions: modified(2),
    };
    expect(row.cacheWarmKey).toBe(await expectedWarmKey(latest, false));
  });

  it("versioning off: the photos row is warmed under plain keys exactly as before", async () => {
    await db.update(schema.galleries).set({ versioning: false });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const { drive, calls } = fakeWarmDrive();
    await warmGalleryOnOpen(e, drive, "retoque");
    expect(calls.sort()).toEqual(["HI-A-v2", "TH-A-v2", "WEB-A-v2"]);
    expect(await keys()).toEqual(["A/thumb", "A/view-lg", "A/view-sm"]);
  });

  it("stays inside the D1 allowance for a 12-photo versioned album", async () => {
    for (let i = 0; i < 12; i++)
      await seedVersioned(G, `P${i}`, [{ n: 1 }, { n: 2 }], { sort: i });
    const c = countingEnv(e);
    await warmGalleryOnOpen(c.e, fakeWarmDrive().drive, "retoque");
    expect(c.count()).toBeLessThanOrEqual(OPEN_WARM_D1_BUDGET);
  });
});

describe("T6.53c the cron warm and the cover warm are version-aware", () => {
  it("warmBatch fetches the latest version into the v2 keys and moves the marker", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const { drive, calls } = fakeWarmDrive();
    const r = await warmBatch(e, { drive });
    expect(r.warmed).toBe(1);
    expect(calls.sort()).toEqual(["TH-A-v2", "WEB-A-v2"]);
    expect(await keys()).toEqual(["A/v2/thumb", "A/v2/view-sm"]);
    const [row] = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.id, "A"));
    expect(row.cacheWarmKey).toBe(row.cacheExpectedKey);
    // Nothing stale on the next run.
    expect((await warmBatch(e, { drive })).stale).toBe(0);
  });

  it("warmBatch on a versioning-off album: query shape unchanged (plain keys, mirror files)", async () => {
    await db.update(schema.galleries).set({ versioning: false });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const { drive, calls } = fakeWarmDrive();
    await warmBatch(e, { drive });
    expect(calls.sort()).toEqual(["TH-A-v2", "WEB-A-v2"]);
    expect(await keys()).toEqual(["A/thumb", "A/view-sm"]);
  });

  it("warmCoverPhoto warms the cover's latest version", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const { drive, calls } = fakeWarmDrive();
    await warmCoverPhoto(e, drive, G, "A");
    expect(calls.sort()).toEqual(["TH-A-v2", "WEB-A-v2"]);
    expect(await keys()).toEqual(["A/v2/thumb", "A/v2/view-sm"]);
  });
});

describe("T6.53c stale scan version lookups", () => {
  it("no allowance, no version lookup; a minimal one still returns a row", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const none = countingEnv(e);
    expect((await staleRows(none.e, 0)).rows).toEqual([]);
    expect(none.count()).toBe(1); // the select only
    expect((await staleRows(e, 1)).rows).toHaveLength(1);
  });
});
