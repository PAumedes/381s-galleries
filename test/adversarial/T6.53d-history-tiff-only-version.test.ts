import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { buildOpenData } from "../../app/lib/server/gallery-open-data";
import { resolveSource } from "../../app/lib/server/image-source";
import {
  atVersion,
  loadGalleryVersions,
} from "../../app/lib/server/photo-versions";
import { migrateDb, resetTables } from "../support/d1";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000f1";
beforeAll(migrateDb);

/** The retouching agency's normal flow: v1 JPEG for colour check, final v2 = TIFF only. */
describe("T6.53d adversary: history of a versioned album with a TIFF-only version", () => {
  it("never lists a version that has no image (its history preview / thumb would be a 404 <img>)", async () => {
    await resetTables(
      "photo_versions",
      "delivery_rounds",
      "photos",
      "galleries",
    );
    await db.insert(schema.galleries).values({
      id: G,
      driveFolderId: "f",
      slug: "h",
      title: "H",
      status: "published",
      versioning: true,
    });
    const vv = JSON.stringify({
      highres: "2026-03-01T00:00:00Z",
      web: "2026-03-01T00:00:01Z",
      tiff: "2026-03-02T00:00:00Z",
    });
    await db.insert(schema.photos).values({
      id: "A",
      galleryId: G,
      baseName: "A",
      sort: 0,
      driveHighresId: "TIF2",
      driveTiffId: "TIF2",
      variantVersions: vv,
      width: null,
      height: null,
    });
    await db.insert(schema.deliveryRounds).values({
      id: "r2",
      galleryId: G,
      number: 2,
      startedAt: "2026-03-02T00:00:00.000Z",
    });
    await db.insert(schema.photoVersions).values([
      {
        photoId: "A",
        galleryId: G,
        version: 1,
        driveHighresId: "HI1",
        driveWebId: "WEB1",
        driveThumbId: "TH1",
        driveVersions: vv,
        width: 3000,
        height: 2000,
        firstSeenAt: "2026-03-01T00:00:00.000Z",
      },
      {
        photoId: "A",
        galleryId: G,
        version: 2,
        roundId: "r2",
        driveHighresId: "TIF2",
        driveTiffId: "TIF2",
        driveVersions: vv,
        width: null,
        height: null,
        firstSeenAt: "2026-03-02T00:00:00.000Z",
      },
    ]);
    const [g] = await db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.id, G));
    const d = await buildOpenData(env, g);
    const p = d.photos.find((x) => x.id === "A")!;
    expect(p.noPreview).toBe(true);
    const [row] = await db.select().from(schema.photos);
    const live = (await loadGalleryVersions(env, G)).get("A")!;
    const listed = p.versions ?? [];
    expect(listed.length).toBeGreaterThan(0);
    for (const entry of listed) {
      const r = live.find((x) => x.version === entry.n)!;
      // what /img?ver=N would serve for view-sm and thumb
      expect(
        resolveSource(atVersion(row, r), false, "view-sm"),
        `v${entry.n} view-sm`,
      ).not.toBeNull();
      expect(
        resolveSource(atVersion(row, r), false, "thumb"),
        `v${entry.n} thumb`,
      ).not.toBeNull();
    }
  });
});
