import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "../../app/db";
import { serveImage } from "../../app/lib/server/images";
import { buildOpenData } from "../../app/lib/server/gallery-open-data";
import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";
import { fakeWarmDrive, noRatePrune } from "../support/warm";
import { seedVersioned } from "../support/versions";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000c1";
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
    slug: "s",
    title: "t",
    status: "published",
    versioning: true,
  });
  return () => vi.restoreAllMocks();
});

async function get(variant: string, query: string, photoId = "A") {
  const drive = fakeWarmDrive();
  const pending: Promise<unknown>[] = [];
  const res = await serveImage(
    new Request(`https://x.test/img/${photoId}/${variant}${query}`),
    { photoId, variant },
    e,
    {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
      passThroughOnException() {},
    } as unknown as ExecutionContext,
    { drive: drive.drive },
  );
  await Promise.all(pending);
  return { res, calls: drive.calls };
}

describe("T6.53c /img?ver= abuse", () => {
  it.each([
    "0",
    "-1",
    "1000",
    "1e3",
    "2%20",
    "02",
    "%2B2",
    "",
    "2.0",
    "0x2",
    "%D9%A2",
  ])("ver=%s is a 404 with no Drive call", async (q) => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const { res, calls } = await get("thumb", `?ver=${q}`);
    expect(res.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("a Prueba version without preview-wm never serves a clean file, any variant, with or without ver", async () => {
    await db.update(schema.galleries).set({ mode: "proofing" });
    await seedVersioned(G, "A", [
      { n: 1, wm: false },
      { n: 2, wm: false },
    ]);
    for (const q of ["", "?ver=1", "?ver=2"])
      for (const v of ["thumb", "view-sm", "view-lg"]) {
        const { res, calls } = await get(v, q);
        expect(res.status, `${v}${q}`).toBe(404);
        expect(calls).toEqual([]);
      }
  });

  it("another photo's ver cannot be read through photo A's id", async () => {
    await seedVersioned(G, "A", [{ n: 1 }]);
    await seedVersioned(G, "B", [{ n: 1 }, { n: 2 }], { sort: 1 });
    const { res } = await get("thumb", "?ver=2", "A");
    expect(res.status).toBe(404);
  });

  it("a version row stale from the unversioned era (photos replaced since) is not shown after switching versioning on", async () => {
    await seedVersioned(G, "A", [{ n: 1 }]);
    // versioning=0 era: sync kept updating `photos` but never the version rows.
    await db.update(schema.galleries).set({ versioning: false });
    await db
      .update(schema.photos)
      .set({
        driveThumbId: "TH-NEW",
        driveWebId: "WEB-NEW",
        driveHighresId: "HI-NEW",
      })
      .where(eq(schema.photos.id, "A"));
    // The owner switches the album on; the sync has not run yet.
    await db.update(schema.galleries).set({ versioning: true });
    const { calls } = await get("thumb", "");
    expect(calls).toEqual(["TH-NEW"]);
  });
});

describe("T6.53c open data", () => {
  it("never carries a Drive id, round id or key", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }, { n: 3 }]);
    const [g] = await db.select().from(schema.galleries);
    const data = JSON.stringify(await buildOpenData(env, g));
    expect(data).not.toMatch(/HI-|WEB-|TH-|WM-|TWM-|round-|roundId|drive/i);
  });
});
