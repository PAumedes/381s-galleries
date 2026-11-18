import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { loadGalleryEdit } from "../../app/lib/server/admin-galleries";
import { loadGallery } from "../../app/lib/server/gallery";
import type { DriveClient } from "../../app/lib/server/drive-types";
import { serveImage } from "../../app/lib/server/images";

const db = getDb(env);
const G = "aaaaaaaa-0000-4000-8000-00000000t612";
const P1 = "pppppppp-0000-4000-8000-00000000t601"; // has preview-wm + thumb-wm
const P2 = "pppppppp-0000-4000-8000-00000000t602"; // clean files only (no wm yet)
const ctx = { waitUntil() {} };

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  for (const o of (await env.CACHE.list()).objects)
    await env.CACHE.delete(o.key);
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "prueba-t612",
    title: "T",
    status: "published",
    mode: "proofing",
  });
  await db.insert(schema.photos).values([
    {
      id: P1,
      galleryId: G,
      baseName: "A",
      driveHighresId: "HI1",
      driveWmId: "WM1",
      driveThumbWmId: "TWM1",
      variantVersions: JSON.stringify({ wm: "w1", thumbWm: "t1" }),
      width: 3000,
      height: 2000,
      sort: 0,
    },
    {
      id: P2,
      galleryId: G,
      baseName: "B",
      driveHighresId: "HI2",
      width: 2000,
      height: 3000,
      sort: 1,
    },
  ]);
});

describe("T6.12 Prueba + mobile cover", () => {
  it("the editor never shows a mobile cover the public page drops (broken image in the admin preview)", async () => {
    await db
      .update(schema.galleries)
      .set({ coverPhotoIdMobile: P2 })
      .where(
        // trigger needs the photo in the same gallery: it is.
        (await import("drizzle-orm")).eq(schema.galleries.id, G),
      );
    const edit = await loadGalleryEdit(env, G);
    const pub = await loadGallery(
      new Request("https://x.test/prueba-t612"),
      "prueba-t612",
      env,
    );
    if (pub.data.state !== "open") throw new Error("not open");
    // Public: dropped (no preview-wm). Editor: still shows it, and
    // /admin/img/<P2>/view-sm-wm 404s, so the live preview paints nothing.
    expect(edit!.gallery.coverPhotoIdMobile).toBe(
      pub.data.gallery.coverPhotoIdMobile,
    );
  });
});

describe("T6.12 admin thumb-wm in Prueba", () => {
  it("serves a valid watermarked R2 object instead of re-downloading every thumb from Drive", async () => {
    // The public cache object photo/thumb is exactly the watermarked thumb
    // (customMetadata wm=1, same fileId and version): safe for the admin wm variant.
    await env.CACHE.put(`${P1}/thumb`, "WM-THUMB-BYTES", {
      customMetadata: { fileId: "TWM1", wm: "1", v: "t1" },
      httpMetadata: { contentType: "image/jpeg" },
    });
    let driveCalls = 0;
    const drive = {
      async streamFile() {
        driveCalls++;
        throw new Error("drive must not be hit for a cached watermarked thumb");
      },
    } as unknown as DriveClient;
    const e = { ...env, DRIVE_MODE: "google" } as Env;
    // serveAdminImage = requireAdmin + serveImage(..., { admin: true })
    const res = await serveImage(
      new Request(`http://localhost/admin/img/${P1}/thumb-wm`),
      { photoId: P1, variant: "thumb-wm" },
      e,
      ctx,
      { drive },
      { admin: true },
    );
    expect(driveCalls).toBe(0);
    expect(res.status).toBe(200);
  });
});

describe("T6.12 Prueba desktop cover", () => {
  it("a chosen cover without preview-wm is not announced as the public cover (hero would 404)", async () => {
    await db
      .update(schema.galleries)
      .set({ coverPhotoId: P2 })
      .where((await import("drizzle-orm")).eq(schema.galleries.id, G));
    const pub = await loadGallery(
      new Request("https://x.test/prueba-t612"),
      "prueba-t612",
      env,
    );
    if (pub.data.state !== "open") throw new Error("not open");
    const id = pub.data.gallery.coverPhotoId!;
    const r = await serveImage(
      new Request(`https://x.test/img/${id}/view-lg`),
      { photoId: id, variant: "view-lg" },
      { ...env, DRIVE_MODE: "google" } as Env,
      ctx,
      { drive: { streamFile: async () => new Response("x") } as never },
    );
    expect(r.status).toBe(200);
  });
});
