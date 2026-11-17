import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { normalizeSearch } from "../app/lib/admin-gallery";
import {
  galleryAction,
  listGalleries,
  loadGalleryEdit,
} from "../app/lib/server/admin-galleries";
import type { DriveClient } from "../app/lib/server/drive-types";
import { mockImageUrl } from "../app/lib/server/drive-mock";
import { loadGallery } from "../app/lib/server/gallery";
import { serveImage } from "../app/lib/server/images";
import { adminIndexData } from "../app/routes/admin._index";
import { serveAdminImage } from "../app/routes/admin.img.$photoId.$variant";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const G = "aaaaaaaa-0000-0000-0000-0000000000a1";
const P1 = "pppppppp-0000-0000-0000-000000000001";
const P2 = "pppppppp-0000-0000-0000-000000000002";
const ctx = { waitUntil() {}, passThroughOnException() {} } as ExecutionContext;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);

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
});

async function seed(
  g: Partial<typeof schema.galleries.$inferInsert> = {},
  wm = true,
) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "folder-x",
    slug: "boda",
    title: "Boda",
    status: "published",
    ...g,
  });
  await db.insert(schema.photos).values([
    {
      id: P1,
      galleryId: G,
      baseName: "A",
      driveHighresId: "HI1",
      driveWebId: "WEB1",
      driveWmId: wm ? "WM1" : null,
      variantVersions: JSON.stringify({ web: "v", highres: "v", wm: "v" }),
      width: 3000,
      height: 2000,
      sort: 0,
    },
    {
      id: P2,
      galleryId: G,
      baseName: "B",
      driveHighresId: "HI2",
      sort: 1,
    },
  ]);
}
const post = (fields: Record<string, string>) =>
  new Request(`http://localhost/admin/g/${G}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });
const act = (fields: Record<string, string>) =>
  galleryAction(post(fields), e, G);
const row = async () =>
  (
    await db.select().from(schema.galleries).where(eq(schema.galleries.id, G))
  )[0];

describe("cover focus (migration 0014 + intent focus)", () => {
  it("columns exist and default to null (center)", async () => {
    await seed();
    const r = await row();
    expect(r.coverFocusX).toBeNull();
    expect(r.coverFocusY).toBeNull();
  });
  it("saves x,y within 0-100 and reports them to the editor", async () => {
    await seed();
    const r = await act({ intent: "focus", focusX: "20", focusY: "75.5" });
    expect(r.ok).toBe(true);
    const g = await row();
    expect([g.coverFocusX, g.coverFocusY]).toEqual([20, 75.5]);
    const edit = await loadGalleryEdit(e, G);
    expect(edit!.gallery.coverFocus).toEqual({ x: 20, y: 75.5 });
  });
  it("accepts any finite number in range and rounds to one decimal", async () => {
    await seed();
    const r = await act({
      intent: "focus",
      focusX: "0.2999999999999998",
      focusY: "33.3333333",
    });
    expect(r.ok).toBe(true);
    const g = await row();
    expect([g.coverFocusX, g.coverFocusY]).toEqual([0.3, 33.3]);
    expect(
      (await act({ intent: "focus", focusX: "1e1", focusY: "5.55" })).ok,
    ).toBe(true);
  });
  it("accepts the edges 0 and 100", async () => {
    await seed();
    expect(
      (await act({ intent: "focus", focusX: "0", focusY: "100" })).ok,
    ).toBe(true);
  });
  it.each([
    ["-1", "50"],
    ["50", "101"],
    ["abc", "50"],
    ["NaN", "50"],
    ["Infinity", "50"],
    ["1e3", "50"],
    ["50", ""],
    ["", "50"],
    ["0x10", "50"],
  ])("rejects focus %s,%s and keeps the stored value", async (x, y) => {
    await seed({ coverFocusX: 10, coverFocusY: 20 });
    const r = await act({ intent: "focus", focusX: x, focusY: y });
    expect(r.ok).toBe(false);
    const g = await row();
    expect([g.coverFocusX, g.coverFocusY]).toEqual([10, 20]);
  });
  it("both empty = back to center (null)", async () => {
    await seed({ coverFocusX: 10, coverFocusY: 20 });
    expect((await act({ intent: "focus", focusX: "", focusY: "" })).ok).toBe(
      true,
    );
    const g = await row();
    expect([g.coverFocusX, g.coverFocusY]).toEqual([null, null]);
  });
  it("saving a cover photo (or automatic) resets the focus to center", async () => {
    await seed({ coverFocusX: 10, coverFocusY: 20 });
    expect((await act({ intent: "cover", photoId: P1 })).ok).toBe(true);
    let g = await row();
    expect([g.coverPhotoId, g.coverFocusX, g.coverFocusY]).toEqual([
      P1,
      null,
      null,
    ]);
    await act({ intent: "focus", focusX: "30", focusY: "30" });
    await act({ intent: "cover", photoId: "" });
    g = await row();
    expect([g.coverFocusX, g.coverFocusY]).toEqual([null, null]);
  });
  it("a rejected cover keeps the focus", async () => {
    await seed({ coverFocusX: 10, coverFocusY: 20 });
    expect((await act({ intent: "cover", photoId: "nope" })).ok).toBe(false);
    expect((await row()).coverFocusX).toBe(10);
  });
  it("focus is admin-only and CSRF-guarded", async () => {
    await seed();
    const r = await galleryAction(
      post({ intent: "focus", focusX: "1", focusY: "1" }),
      { ...e, ALLOW_DEV_ADMIN: "0" } as Env,
      G,
    ).catch((x) => x as Response);
    expect((r as Response).status).toBe(401);
    const x = await galleryAction(
      new Request(`http://localhost/admin/g/${G}`, {
        method: "POST",
        headers: { "Sec-Fetch-Site": "cross-site" },
        body: new URLSearchParams({
          intent: "focus",
          focusX: "1",
          focusY: "1",
        }),
      }),
      e,
      G,
    ).catch((z) => z as Response);
    expect((x as Response).status).toBe(403);
    expect((await row()).coverFocusX).toBeNull();
  });
  it("an automatic cover stays null in the editor payload (the view picks the first photo)", async () => {
    await seed();
    expect((await loadGalleryEdit(e, G))!.gallery.coverFocus).toBeNull();
    expect((await loadGalleryEdit(e, G))!.gallery.coverPhotoId).toBeNull();
  });
  it("public payload carries the focus; null when unset", async () => {
    await seed({ coverFocusX: 12.5, coverFocusY: 80 });
    const r = await loadGallery(
      new Request("https://x.test/boda"),
      "boda",
      env,
    );
    expect(r.status).toBe(200);
    if (r.data.state !== "open") throw new Error("not open");
    expect(r.data.gallery.coverFocus).toEqual({ x: 12.5, y: 80 });
    await db
      .update(schema.galleries)
      .set({ coverFocusX: null, coverFocusY: null })
      .where(eq(schema.galleries.id, G));
    const r2 = await loadGallery(
      new Request("https://x.test/boda"),
      "boda",
      env,
    );
    if (r2.data.state !== "open") throw new Error("not open");
    expect(r2.data.gallery.coverFocus).toBeNull();
  });
});

describe("admin image: view-sm-wm", () => {
  const streamed: string[] = [];
  const drive = {
    async streamFile(id: string) {
      streamed.push(id);
      return new Response(JPEG.slice(), {
        headers: { "Content-Length": String(JPEG.length) },
      });
    },
  } as unknown as DriveClient;
  const google = { ...env, DRIVE_MODE: "google" } as Env;
  /** Google path: the route's admin check is bypassed (dev admin is mock-only). */
  const getG = (photoId: string, variant: string) =>
    serveImage(
      new Request(`http://localhost/admin/img/${photoId}/${variant}`),
      { photoId, variant },
      google,
      ctx,
      { drive },
      { admin: true },
    );
  const get = (photoId: string, variant: string, en: Env = e) =>
    serveAdminImage(
      new Request(`http://localhost/admin/img/${photoId}/${variant}`),
      { photoId, variant },
      en,
      ctx,
      { drive },
    );

  it("serves the preview-wm file even for a delivery gallery, no-store, never cached in R2", async () => {
    streamed.length = 0;
    await seed({ status: "draft", mode: "delivery" });
    const r = await getG(P1, "view-sm-wm");
    expect(r.status).toBe(200);
    expect(streamed).toEqual(["WM1"]);
    expect(r.headers.get("Cache-Control")).toMatch(/private/);
    expect((await env.CACHE.list()).objects).toHaveLength(0);
  });
  it("mock mode redirects to the wm sample", async () => {
    await seed();
    const r = await get(P1, "view-sm-wm", e);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(mockImageUrl(P1, "wm", 3000, 2000));
  });
  it("404 when the photo has no preview-wm (no clean fallback)", async () => {
    await seed();
    expect((await getG(P2, "view-sm-wm")).status).toBe(404);
  });
  it("401 for non-admins; the public route does not know the variant", async () => {
    await seed();
    const r = await get(P1, "view-sm-wm", {
      ...e,
      ALLOW_DEV_ADMIN: "0",
    } as Env).catch((x) => x as Response);
    expect((r as Response).status).toBe(401);
    const pub = await serveImage(
      new Request(`http://localhost/img/${P1}/view-sm-wm`),
      { photoId: P1, variant: "view-sm-wm" },
      google,
      ctx,
      { drive },
    );
    expect(pub.status).toBe(404);
  });
  it("other -wm variants stay unknown", async () => {
    await seed();
    for (const v of ["thumb-wm", "view-lg-wm"])
      expect((await getG(P1, v)).status).toBe(404);
  });
});

describe("normalizeSearch", () => {
  it("lowercases, strips accents and trims", () => {
    expect(normalizeSearch("  Ángeles ÑANDÚ ")).toBe("angeles nandu");
    expect(normalizeSearch("Cumpleaños")).toBe("cumpleanos");
  });
});

describe("gallery list: client name and ?q search", () => {
  async function three() {
    const mk = (
      i: number,
      title: string,
      slug: string,
      client: string | null,
    ) =>
      db.insert(schema.galleries).values({
        id: `bbbbbbbb-0000-0000-0000-00000000000${i}`,
        driveFolderId: `f${i}`,
        slug,
        title,
        clientName: client,
        status: "draft",
      });
    await mk(1, "Boda Lucía", "boda-lucia", "María Pérez");
    await mk(2, "Cumpleaños 15", "xv-sofi", "Sofía Gómez");
    await mk(3, "Corporativo", "acme-2026", null);
  }
  const titles = async (q?: string) =>
    (await listGalleries(env, "todas", q)).map((g) => g.title).sort();

  it("rows carry clientName (null when unset)", async () => {
    await three();
    const all = await listGalleries(env, "todas");
    expect(all.find((g) => g.slug === "xv-sofi")!.clientName).toBe(
      "Sofía Gómez",
    );
    expect(all.find((g) => g.slug === "acme-2026")!.clientName).toBeNull();
  });
  it("no q or blank q = everything", async () => {
    await three();
    expect(await titles()).toHaveLength(3);
    expect(await titles("   ")).toHaveLength(3);
  });
  it("matches title, slug and client, case/accent-insensitive both ways", async () => {
    await three();
    expect(await titles("LUCIA")).toEqual(["Boda Lucía"]);
    expect(await titles("lucía")).toEqual(["Boda Lucía"]);
    expect(await titles("xv-SOFI")).toEqual(["Cumpleaños 15"]);
    expect(await titles("sofia gomez")).toEqual(["Cumpleaños 15"]);
    expect(await titles("maria")).toEqual(["Boda Lucía"]);
    expect(await titles("cumpleanos")).toEqual(["Cumpleaños 15"]);
    expect(await titles("zzz")).toEqual([]);
  });
  it("treats LIKE wildcards literally and combines with the status filter", async () => {
    await three();
    expect(await titles("%")).toEqual([]);
    expect(await titles("_")).toEqual([]);
    expect(await titles("15")).toEqual(["Cumpleaños 15"]);
    expect((await listGalleries(env, "publicadas", "boda")).length).toBe(0);
  });
  it("the index loader reads ?q and echoes it", async () => {
    await three();
    const d = await adminIndexData(
      new Request("http://localhost/admin?q=sofia"),
      e,
    );
    expect(d.q).toBe("sofia");
    expect(d.galleries.map((g) => g.slug)).toEqual(["xv-sofi"]);
    const long = await adminIndexData(
      new Request(`http://localhost/admin?q=${"a".repeat(500)}`),
      e,
    );
    expect(long.q.length).toBeLessThanOrEqual(100);
  });
});
