import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getDb, schema } from "../app/db";
import { clearCache } from "./support/cache";
import { migrateDb, resetTables } from "./support/d1";
import {
  countingEnv,
  noRatePrune,
  fakeWarmDrive,
  photoId,
  seedGallery,
  seedPhotos,
  warmGalleryId,
} from "./support/warm";
import {
  warmGalleryAtPublish,
  warmGalleryOnOpen,
} from "../app/lib/server/gallery-warm";

const db = getDb(env);
const base = { ...env, DRIVE_MODE: "google" } as Env;
beforeAll(async () => {
  await migrateDb();
});
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  noRatePrune();
  await db.delete(schema.galleries);
  await resetTables("settings", "rate_limits");
  await clearCache();
});

describe("T6.47 D1 budget of a walk that ends on the D1 budget", () => {
  // [budget, queries spent in total (guards, walk, cursor save), photos warmed]
  const cases: [number, number, number][] = [
    [13, 11, 2],
    [15, 11, 2],
    [18, 14, 4],
    [21, 17, 6],
    [24, 20, 8],
    [30, 26, 12],
  ];
  for (const [budget, spent, warmed] of cases) {
    it(`budget ${budget}: stops on D1 and the cursor save stays within it (${spent} queries)`, async () => {
      const g = warmGalleryId(1);
      await seedGallery(g);
      await seedPhotos(g, 40);
      const { e, count } = countingEnv(base);
      const { drive } = fakeWarmDrive();
      const r = await warmGalleryOnOpen(e, drive, "s-" + g.slice(-3), budget);
      expect(r).toMatchObject({ stopped: "budget", warmed });
      expect(count()).toBe(spent);
      expect(count()).toBeLessThanOrEqual(budget);
      // The cursor was saved by the last queries, so the next run continues.
      const cursor = await db.select().from(schema.settings);
      expect(cursor.some((s) => s.key.startsWith("warm_cursor"))).toBe(true);
    });
  }
});

describe("T6.47 publish warm: which variants a cover requests", () => {
  const callsFor = async (over: Record<string, unknown>) => {
    const g = warmGalleryId(2);
    await seedGallery(g, over);
    await seedPhotos(g, 1);
    const { drive, calls } = fakeWarmDrive();
    await warmGalleryAtPublish(base, drive, g);
    const id = `${g.slice(-3)}p000`;
    return { calls, id };
  };
  it("Prueba: only the watermarked thumb and preview, each fetched once, no clean file", async () => {
    const { calls, id } = await callsFor({ mode: "proofing" });
    expect(calls).toEqual([`TWM-${id}`, `WM-${id}`]);
  });
  it("Entrega: thumb, view-sm and view-lg of the cover, each once", async () => {
    const { calls, id } = await callsFor({});
    expect(calls).toEqual([`TH-${id}`, `WEB-${id}`, `HI-${id}`]);
  });
  it("Prueba cover other than the first photo: it is warmed first, watermarked only", async () => {
    const g = warmGalleryId(3);
    await seedGallery(g, { mode: "proofing" });
    await seedPhotos(g, 2);
    await db
      .update(schema.galleries)
      .set({ coverPhotoId: photoId(g, 1) })
      .where(eq(schema.galleries.id, g));
    const { drive, calls } = fakeWarmDrive();
    await warmGalleryAtPublish(base, drive, g);
    const [a, b] = [photoId(g, 0), photoId(g, 1)];
    expect(calls).toEqual([`TWM-${b}`, `WM-${b}`, `TWM-${a}`, `WM-${a}`]);
  });

  it("Entrega cover other than the first photo: all three variants before the grid walk", async () => {
    const g = warmGalleryId(4);
    await seedGallery(g);
    await seedPhotos(g, 2);
    await db
      .update(schema.galleries)
      .set({ coverPhotoId: photoId(g, 1) })
      .where(eq(schema.galleries.id, g));
    const { drive, calls } = fakeWarmDrive();
    await warmGalleryAtPublish(base, drive, g);
    const [a, b] = [photoId(g, 0), photoId(g, 1)];
    expect(calls).toEqual([
      `TH-${b}`,
      `WEB-${b}`,
      `HI-${b}`,
      `TH-${a}`,
      `WEB-${a}`,
      `HI-${a}`,
    ]);
  });
  it("Prueba cover warm asks for no view-lg of its own (exact D1 query count of the run)", async () => {
    const g = warmGalleryId(5);
    await seedGallery(g, { mode: "proofing" });
    await seedPhotos(g, 1);
    const { e, count } = countingEnv(base);
    const { drive } = fakeWarmDrive();
    await warmGalleryAtPublish(e, drive, g);
    // A third cover variant would add a marker/gate query (21 instead of 20).
    expect(count()).toBe(20);
  });
});
