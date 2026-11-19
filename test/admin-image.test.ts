import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { DriveError } from "../app/lib/server/drive-types";
import type { DriveClient } from "../app/lib/server/drive-types";
import { serveImage } from "../app/lib/server/images";
import { serveAdminImage } from "../app/routes/admin.img.$photoId.$variant";

const db = getDb(env);
const G = "aaaaaaaa-0000-0000-0000-00000000000a";
const P = "pppppppp-0000-0000-0000-000000000001";
const mockAdmin = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const mockNonAdmin = { ...mockAdmin, ALLOW_DEV_ADMIN: "0" } as Env;
const googleEnv = { ...env, DRIVE_MODE: "google" } as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);

const drive = {
  async streamFile() {
    return new Response(JPEG.slice(), {
      headers: { "Content-Length": String(JPEG.length) },
    });
  },
} as unknown as DriveClient;
const failing = {
  async streamFile() {
    throw new DriveError(404, "x", "detail DRIVE-THUMB");
  },
} as unknown as DriveClient;

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  for (const o of (await env.CACHE.list()).objects)
    await env.CACHE.delete(o.key);
});

async function seed(
  gallery: Partial<typeof schema.galleries.$inferInsert> = {},
  photo: Partial<typeof schema.photos.$inferInsert> = {},
) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "folder-secret",
    slug: "borrador",
    title: "T",
    status: "draft",
    ...gallery,
  });
  await db.insert(schema.photos).values({
    id: P,
    galleryId: G,
    baseName: "p1",
    driveHighresId: "DRIVE-HI",
    driveWebId: "DRIVE-WEB",
    driveThumbId: "DRIVE-THUMB",
    variantVersions: JSON.stringify({ thumb: "v1", web: "v1", highres: "v1" }),
    width: 3000,
    height: 2000,
    ...photo,
  });
}
const req = (v: string, h: HeadersInit = {}) =>
  new Request(`http://localhost/admin/img/${P}/${v}`, { headers: h });
const get = (
  v: string,
  e: Env = googleEnv,
  d: DriveClient = drive,
  photoId = P,
) => serveAdminImage(req(v), { photoId, variant: v }, e, ctx, { drive: d });

describe("admin image route", () => {
  it("401 for non-admin (before touching the DB)", async () => {
    await seed();
    const r = await serveAdminImage(
      req("thumb"),
      { photoId: P, variant: "thumb" },
      mockNonAdmin,
      ctx,
      { drive },
    ).catch((x) => x as Response);
    expect((r as Response).status).toBe(401);
  });

  it("serves thumb and view-sm of a DRAFT gallery to the admin (mock: 302, no drive ids)", async () => {
    await seed();
    for (const v of ["thumb", "view-sm"]) {
      const r = await serveAdminImage(
        req(v),
        { photoId: P, variant: v },
        mockAdmin,
        ctx,
        { drive },
      );
      expect(r.status).toBe(302);
      const loc = r.headers.get("Location")!;
      expect(loc).toContain(P);
      expect(loc).not.toMatch(/DRIVE|folder-secret/);
    }
  });

  it("public route still hides the same draft photo", async () => {
    await seed();
    const r = await serveImage(
      new Request(`http://localhost/img/${P}/thumb`),
      { photoId: P, variant: "thumb" },
      googleEnv,
      ctx,
      { drive },
    );
    expect(r.status).toBe(404);
  });

  it("works for draft, archived and expired galleries (google path streams bytes)", async () => {
    for (const g of [
      { status: "draft" as const },
      { status: "archived" as const },
      { status: "published" as const, expiresAt: "2020-01-01T00:00:00Z" },
    ]) {
      await db.delete(schema.galleries);
      await seed(g);
      const r = await serveImage(
        req("thumb"),
        { photoId: P, variant: "thumb" },
        googleEnv,
        ctx,
        { drive },
        { admin: true },
      );
      expect(r.status, JSON.stringify(g)).toBe(200);
      expect(new Uint8Array(await r.arrayBuffer())).toEqual(JPEG);
      const hdrs = JSON.stringify([...r.headers]);
      expect(hdrs).not.toMatch(/DRIVE|folder-secret/);
    }
  });

  it("PIN-protected gallery needs no cookie for the admin", async () => {
    await seed({ pinHash: "pbkdf2$100000$aaa$bbb", status: "published" });
    const r = await serveImage(
      req("view-sm"),
      { photoId: P, variant: "view-sm" },
      googleEnv,
      ctx,
      { drive },
      { admin: true },
    );
    expect(r.status).toBe(200);
  });

  it("only thumb and view-sm; unknown photo, missing photo and bad variant are 404", async () => {
    await seed();
    expect((await get("view-lg", mockAdmin)).status).toBe(404);
    expect((await get("nope", mockAdmin)).status).toBe(404);
    expect((await get("thumb", mockAdmin, drive, "zzz")).status).toBe(404);
    await db
      .update(schema.photos)
      .set({ missingSince: "2026-01-01T00:00:00Z" });
    expect((await get("thumb", mockAdmin)).status).toBe(404);
  });

  it("Drive failure does not leak ids", async () => {
    await seed();
    const r = await serveImage(
      req("thumb"),
      { photoId: P, variant: "thumb" },
      googleEnv,
      ctx,
      { drive: failing },
      { admin: true },
    );
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain("DRIVE");
  });
});

describe("admin thumb caching (phase-4 review)", () => {
  it("always answers Cache-Control: private, no-store", async () => {
    await seed();
    const r = await serveAdminImage(
      req("thumb"),
      { photoId: P, variant: "thumb" },
      mockAdmin,
      ctx,
      { drive },
    );
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
