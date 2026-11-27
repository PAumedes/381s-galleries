import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "../app/db";
import { loadGalleryEdit } from "../app/lib/server/admin-galleries";
import { VERSIONED_APPROVALS_D1_QUERIES } from "../app/lib/server/d1-limits";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv, noRatePrune } from "./support/warm";
import { seedVersioned } from "./support/versions";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000b7";

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables(
    "photo_approvals",
    "visitors",
    "photo_versions",
    "delivery_rounds",
    "photos",
    "galleries",
  );
  noRatePrune();
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "retoque",
    title: "Retoque",
    status: "published",
    versioning: true,
  });
  for (const id of ["v1", "v2", "v3"])
    await db
      .insert(schema.visitors)
      .values({ id, galleryId: G, email: `${id}@x.co` });
  return () => vi.restoreAllMocks();
});

const approve = (photoId: string, version: number, visitorId: string) =>
  db
    .insert(schema.photoApprovals)
    .values({ galleryId: G, photoId, version, visitorId });
const summary = async (e: Env = env) =>
  (await loadGalleryEdit(e, G))!.approvals;

describe("T6.53f admin overview: approvals summary", () => {
  it("counts photos approved at their latest version, however many visitors approved", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    await seedVersioned(G, "B", [{ n: 1 }], { sort: 1 });
    await seedVersioned(G, "C", [{ n: 1 }], { sort: 2 });
    await seedVersioned(G, "D", [{ n: 1 }, { n: 2 }, { n: 3 }], { sort: 3 });
    await approve("A", 2, "v1");
    await approve("A", 2, "v2"); // the same photo twice: counted once
    await approve("B", 1, "v3");
    await approve("D", 2, "v1"); // approved at v2 but v3 is shown: not counted
    expect(await summary()).toEqual({ approved: 2, total: 4, pending: 2 });
  });

  it("a new version re-opens the photo", async () => {
    await seedVersioned(G, "A", [{ n: 1 }]);
    await approve("A", 1, "v1");
    expect(await summary()).toEqual({ approved: 1, total: 1, pending: 0 });
    await db.insert(schema.photoVersions).values({
      photoId: "A",
      galleryId: G,
      version: 2,
      driveHighresId: "HI-A-v2",
      driveWmId: "WM",
    });
    await db
      .update(schema.photos)
      .set({ driveHighresId: "HI-A-v2" })
      .where(eq(schema.photos.id, "A"));
    expect(await summary()).toEqual({ approved: 0, total: 1, pending: 1 });
  });

  it("an empty album and an album with no approvals", async () => {
    expect(await summary()).toEqual({ approved: 0, total: 0, pending: 0 });
    await seedVersioned(G, "A", [{ n: 1 }]);
    expect(await summary()).toEqual({ approved: 0, total: 1, pending: 1 });
  });

  it("an unversioned album has no summary and pays no query for it", async () => {
    await seedVersioned(G, "A", [{ n: 1 }]);
    await db
      .update(schema.galleries)
      .set({ versioning: false })
      .where(eq(schema.galleries.id, G));
    const off = countingEnv(env);
    const data = (await loadGalleryEdit(off.e, G))!;
    expect("approvals" in data).toBe(false);
    await db
      .update(schema.galleries)
      .set({ versioning: true })
      .where(eq(schema.galleries.id, G));
    const on = countingEnv(env);
    await loadGalleryEdit(on.e, G);
    // versioned albums already pay for their version rows (T6.53c): +1 for them, +budget for approvals
    expect(on.count() - off.count()).toBe(1 + VERSIONED_APPROVALS_D1_QUERIES);
  });

  it("never carries a visitor id, an email or a Drive id", async () => {
    await seedVersioned(G, "A", [{ n: 1 }]);
    await approve("A", 1, "v1");
    const json = JSON.stringify((await loadGalleryEdit(env, G))!.approvals);
    expect(json).not.toMatch(/v1|@x\.co|HI-|visitor/);
  });
});
