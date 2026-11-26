import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { buildOpenData } from "../../app/lib/server/gallery-open-data";
import { loadClientTiles } from "../../app/lib/server/home";
import { migrateDb, resetTables } from "../support/d1";
import { eq } from "drizzle-orm";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "mock" } as Env;

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("photo_versions", "photos", "galleries", "clients");
  await db
    .insert(schema.clients)
    .values({ id: "c", slug: "acme", name: "ACME" });
});

// Prueba, versioned: v1 has a preview-wm, v2 (mirrored in `photos`) is TIFF-only.
// The open payload shows v1 (chooseVersion prefers a servable version), so the
// album opens WITH an image; the SQL twin reads the v2 mirror and says tiffOnly.
it("tile tiffOnly agrees with the open payload's every(noPreview) for a versioned Prueba album", async () => {
  await db.insert(schema.galleries).values({
    id: "g",
    driveFolderId: "d",
    slug: "v",
    title: "V",
    status: "published",
    clientId: "c",
    mode: "proofing",
    versioning: true,
  });
  await db.insert(schema.photos).values({
    id: "p",
    galleryId: "g",
    baseName: "A",
    driveHighresId: "TIF2",
    driveTiffId: "TIF2",
    width: null,
    height: null,
  } as never);
  await db.insert(schema.photoVersions).values([
    {
      photoId: "p",
      galleryId: "g",
      version: 1,
      driveHighresId: "HI1",
      driveWmId: "WM1",
      driveVersions: "{}",
      firstSeenAt: "2026-03-01T00:00:00.000Z",
    },
    {
      photoId: "p",
      galleryId: "g",
      version: 2,
      driveHighresId: "TIF2",
      driveTiffId: "TIF2",
      driveVersions: "{}",
      firstSeenAt: "2026-03-02T00:00:00.000Z",
    },
  ] as never);
  const [g] = await db
    .select()
    .from(schema.galleries)
    .where(eq(schema.galleries.id, "g"));
  const open = await buildOpenData(e, g);
  const payloadTiffOnly =
    open.photos.length > 0 && open.photos.every((p) => p.noPreview);
  const tiles = (await loadClientTiles(e, "acme"))!.tiles as {
    tiffOnly?: boolean;
  }[];
  expect(!!tiles[0]?.tiffOnly).toBe(payloadTiffOnly);
});
