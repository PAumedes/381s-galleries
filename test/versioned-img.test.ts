import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import type { DriveClient } from "../app/lib/server/drive-types";
import { imageVersionToken, serveImage } from "../app/lib/server/images";
import { loadGallery } from "../app/lib/server/gallery";
import { imgUrl } from "../app/components/types";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "google" } as Env;
const G = "aaaaaaaa-0000-0000-0000-00000000000a";
const P = "pppppppp-0000-0000-0000-000000000001";
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const drive = {
  async streamFile() {
    return new Response(JPEG.slice(), {
      headers: { "Content-Length": String(JPEG.length) },
    });
  },
} as unknown as DriveClient;

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "pub",
    title: "T",
    status: "published",
  });
  await db.insert(schema.photos).values({
    id: P,
    galleryId: G,
    baseName: "p1",
    driveHighresId: "DRIVE-HI",
    driveWebId: "DRIVE-WEB",
    driveThumbId: "DRIVE-THUMB",
    driveWmId: "DRIVE-WM",
    variantVersions: JSON.stringify({
      highres: "2026-01-01T00:00:01Z",
      web: "2026-01-01T00:00:02Z",
      thumb: "2026-01-01T00:00:03Z",
      wm: "2026-01-01T00:00:04Z",
    }),
    width: 3000,
    height: 2000,
  });
});

async function token() {
  const [p] = await db.select().from(schema.photos);
  return imageVersionToken(e, p, false);
}
async function get(variant: string, query = "") {
  const pending: Promise<unknown>[] = [];
  const res = await serveImage(
    new Request(`https://x.test/img/${P}/${variant}${query}`),
    { photoId: P, variant },
    e,
    { waitUntil: (p: Promise<unknown>) => void pending.push(p) },
    { drive },
  );
  await Promise.all(pending);
  return res;
}
const IMMUTABLE = "private, max-age=31536000, immutable";

describe("imageVersionToken", () => {
  it("is short hex, stable, and changes with version / wm / file id", async () => {
    const [p] = await db.select().from(schema.photos);
    const a = await imageVersionToken(e, p, false);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await imageVersionToken(e, p, false)).toBe(a);
    expect(await imageVersionToken(e, p, true)).not.toBe(a);
    expect(
      await imageVersionToken(
        e,
        { ...p, variantVersions: p.variantVersions!.replace("02Z", "09Z") },
        false,
      ),
    ).not.toBe(a);
    expect(
      await imageVersionToken(e, { ...p, driveWebId: "OTHER" }, false),
    ).not.toBe(a);
  });
  it("depends on SESSION_SECRET and never contains Drive ids", async () => {
    const [p] = await db.select().from(schema.photos);
    const other = {
      ...e,
      SESSION_SECRET: "k7Q2mZ9xRtV4bN8cLw3Yd6HsPa1JfGe5UoXi0AqT",
    } as Env;
    expect(await imageVersionToken(other, p, false)).not.toBe(
      await imageVersionToken(e, p, false),
    );
  });
});

describe("/img caching headers", () => {
  it.each(["thumb", "view-sm", "view-lg"])(
    "%s: matching v -> immutable 1 year (miss and hit)",
    async (variant) => {
      const v = await token();
      for (let i = 0; i < 2; i++) {
        const res = await get(variant, `?v=${v}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe(IMMUTABLE);
      }
    },
  );
  it("304 keeps the immutable header", async () => {
    const v = await token();
    const first = await get("thumb", `?v=${v}`);
    const etag = first.headers.get("ETag")!;
    const res = await serveImage(
      new Request(`https://x.test/img/${P}/thumb?v=${v}`, {
        headers: { "If-None-Match": etag },
      }),
      { photoId: P, variant: "thumb" },
      e,
      { waitUntil() {} },
      { drive },
    );
    expect(res.status).toBe(304);
    expect(res.headers.get("Cache-Control")).toBe(IMMUTABLE);
  });
  it("mismatched, garbage and absent v keep max-age=600", async () => {
    for (const q of [
      "?v=0000000000000000",
      "?v=",
      "?v=" + "a".repeat(500),
      "",
    ]) {
      const res = await get("thumb", q);
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=600");
    }
  });
  it("a stale v after a re-export is not immutable", async () => {
    const v = await token();
    await db.update(schema.photos).set({
      variantVersions: JSON.stringify({
        web: "2030-01-01T00:00:00Z",
        thumb: "2026-01-01T00:00:03Z",
        highres: "2026-01-01T00:00:01Z",
      }),
    });
    const res = await get("view-sm", `?v=${v}`);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=600");
  });
  it("a wrong v on a locked gallery is still a 404 (no oracle)", async () => {
    await db.update(schema.galleries).set({ pinHash: "pbkdf2$x" });
    const res = await get("thumb", `?v=${await token()}`);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("gallery payload", () => {
  it("each photo carries v (matching the token) and no Drive ids", async () => {
    const r = await loadGallery(new Request("https://x.test/pub"), "pub", e);
    if (r.data.state !== "open") throw new Error("not open");
    expect(r.data.photos[0].v).toBe(await token());
    const json = JSON.stringify(r.data);
    for (const id of ["DRIVE-HI", "DRIVE-WEB", "DRIVE-THUMB", "DRIVE-WM"])
      expect(json).not.toContain(id);
    expect(json).not.toContain("variantVersions");
  });
  it("v follows the watermark flag", async () => {
    await db.update(schema.galleries).set({ mode: "proofing" });
    const r = await loadGallery(new Request("https://x.test/pub"), "pub", e);
    if (r.data.state !== "open") throw new Error("not open");
    const [p] = await db.select().from(schema.photos);
    expect(r.data.photos[0].v).toBe(await imageVersionToken(e, p, true));
  });
});

describe("imgUrl", () => {
  it("appends v only when given", () => {
    expect(imgUrl("a b", "thumb")).toBe("/img/a%20b/thumb");
    expect(imgUrl("p", "view-sm", "abc123")).toBe("/img/p/view-sm?v=abc123");
  });
});

describe("imageVersionToken with unknown versions", () => {
  it("is null when any served variant has no known version", async () => {
    const [p] = await db.select().from(schema.photos);
    expect(await imageVersionToken(e, p, false)).toEqual(expect.any(String));
    expect(
      await imageVersionToken(
        e,
        { ...p, variantVersions: JSON.stringify({ web: "w", highres: "h" }) },
        false,
      ),
    ).toBeNull();
    expect(
      await imageVersionToken(e, { ...p, variantVersions: null }, false),
    ).toBeNull();
  });
});
