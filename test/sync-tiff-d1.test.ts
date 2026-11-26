import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "../app/db";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../app/lib/server/drive-types";
import type { MockEntry } from "../app/lib/server/fixtures";
import { runSync } from "../app/lib/server/sync";

/** T6.53d: sync writes TIFF originals to photos (and photo_versions); other albums are untouched. */
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const T = "2026-01-01T00:00:00.000Z";
const ROOT = "root";
const GID = "g1";
const T0 = new Date("2026-03-01T12:00:00Z");

const folder = (id: string, name: string, parentId: string): MockEntry => ({
  id,
  name,
  mimeType: FOLDER_MIME,
  modifiedTime: T,
  parentId,
});
const FOLDERS: MockEntry[] = [
  { ...folder(ROOT, "root", ""), parentId: null },
  folder("alb", "Alb", ROOT),
  folder("hr", "high-res", "alb"),
  folder("web", "web", "alb"),
  folder("thumb", "thumb", "alb"),
  folder("tiff", "TIFF", "alb"),
];
type F = [string, string, Partial<MockEntry>?];
const sync = (files: F[], now = T0) =>
  runSync(e, {
    drive: createMockDrive({
      rootId: ROOT,
      entries: [
        ...FOLDERS,
        ...files.map(([parent, name, over]): MockEntry => ({
          id: `${parent}/${name}`,
          name,
          mimeType: "image/jpeg",
          modifiedTime: T,
          parentId: parent,
          width: 2000,
          height: 1000,
          size: 1000,
          ...over,
        })),
      ],
    }),
    force: true,
    now,
    budget: 200,
  });
const TIF = {
  mimeType: "image/tiff",
  size: 300_000_000,
  width: 9000,
  height: 6000,
};
const photos = () =>
  db.select().from(schema.photos).where(eq(schema.photos.galleryId, GID));
const versions = () =>
  db
    .select()
    .from(schema.photoVersions)
    .orderBy(asc(schema.photoVersions.version));
const addGallery = (versioning: boolean) =>
  db.insert(schema.galleries).values({
    id: GID,
    driveFolderId: "alb",
    slug: "alb",
    title: "Alb",
    status: "published",
    versioning,
  });

beforeAll(migrateDb);
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.delete(schema.settings);
  await db
    .insert(schema.settings)
    .values({ key: "drive_root_id", value: ROOT });
});

describe("T6.53d sync: TIFF originals reach D1", () => {
  it("a `TIFF/` folder file alone is a TIFF-only photo (ids equal, no size, bytes of the TIFF, no issue about the folder)", async () => {
    await addGallery(false);
    await sync([["tiff", "IMG_1.TIF", TIF]]);
    const [p] = await photos();
    expect(p).toMatchObject({
      baseName: "IMG_1",
      driveHighresId: "tiff/IMG_1.TIF",
      driveTiffId: "tiff/IMG_1.TIF",
      driveWebId: null,
      highresBytes: 300_000_000,
      width: null,
      height: null,
      missingSince: null,
    });
    const [g] = await db.select().from(schema.galleries);
    expect(g.syncIssuesJson).not.toContain("unknown_folder");
    expect(g.syncIssuesJson).not.toContain("not_jpeg");
  });

  it("TIFF + web + thumb JPEGs: previews as today, size from the previews, the TIFF is the original", async () => {
    await addGallery(false);
    await sync([
      ["tiff", "IMG_1.tif", TIF],
      ["web", "IMG_1.jpg", { width: 2048, height: 1365 }],
      ["thumb", "IMG_1.jpg", { width: 600, height: 400 }],
    ]);
    const [p] = await photos();
    expect(p).toMatchObject({
      driveHighresId: "tiff/IMG_1.tif",
      driveTiffId: "tiff/IMG_1.tif",
      driveWebId: "web/IMG_1.jpg",
      driveThumbId: "thumb/IMG_1.jpg",
      width: 2048,
      height: 1365,
    });
  });

  it("replacing the TIFF updates the row (new id and bytes); a JPEG-only photo never gets a TIFF id", async () => {
    await addGallery(false);
    await sync([
      ["tiff", "A.tif", TIF],
      ["hr", "B.jpg"],
    ]);
    const r = await sync([
      [
        "tiff",
        "A.tif",
        { ...TIF, size: 5, modifiedTime: "2026-02-01T00:00:00Z" },
      ],
      ["hr", "B.jpg"],
    ]);
    expect(r.photos.updated).toBe(1);
    const rows = Object.fromEntries(
      (await photos()).map((p) => [p.baseName, p]),
    );
    expect(rows.A.highresBytes).toBe(5);
    expect(rows.B.driveTiffId).toBeNull();
  });

  it("versioned album: the version row carries drive_tiff_id and the mirror stays equal", async () => {
    await addGallery(true);
    await sync([["tiff", "IMG_1.tif", TIF]]);
    const [p] = await photos();
    expect(await versions()).toMatchObject([
      {
        photoId: p.id,
        version: 1,
        driveHighresId: "tiff/IMG_1.tif",
        driveTiffId: "tiff/IMG_1.tif",
        highresBytes: 300_000_000,
      },
    ]);
    await sync(
      [
        ["tiff", "IMG_1.tif", TIF],
        ["tiff", "IMG_1_v2.tif", { ...TIF, size: 7 }],
      ],
      new Date(T0.getTime() + 20 * 60_000),
    );
    const [p2] = await photos();
    expect(p2).toMatchObject({
      driveTiffId: "tiff/IMG_1_v2.tif",
      highresBytes: 7,
    });
    expect((await versions()).map((v) => v.driveTiffId)).toEqual([
      "tiff/IMG_1.tif",
      "tiff/IMG_1_v2.tif",
    ]);
  });
});
