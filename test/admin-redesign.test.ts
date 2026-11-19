import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import {
  galleryAction,
  loadGalleryEdit,
} from "../app/lib/server/admin-galleries";
import { loadGallery } from "../app/lib/server/gallery";
import { serveImage } from "../app/lib/server/images";
import type { DriveClient } from "../app/lib/server/drive-types";
import { serveAdminImage } from "../app/routes/admin.img.$photoId.$variant";
import {
  headers as previewHeaders,
  meta as previewMeta,
  previewData,
} from "../app/routes/admin.g.$id.preview";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const nonAdmin = { ...e, ALLOW_DEV_ADMIN: "0" } as Env;
const db = getDb(env);
const G = "aaaaaaaa-0000-4000-8000-0000000000r1";
const G2 = "aaaaaaaa-0000-4000-8000-0000000000r2";
const P1 = "pppppppp-0000-4000-8000-00000000r001";
const P2 = "pppppppp-0000-4000-8000-00000000r002";
const P3 = "pppppppp-0000-4000-8000-00000000r003";
const PX = "pppppppp-0000-4000-8000-00000000rx01"; // other gallery
const ctx = { waitUntil() {}, passThroughOnException() {} } as ExecutionContext;
const noDrive = {
  streamFile: () => {
    throw new Error("no drive in this test");
  },
} as unknown as DriveClient;

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.delete(schema.rateLimits);
});

async function seed(over: Partial<typeof schema.galleries.$inferInsert> = {}) {
  // The cover must reference an existing photo (trigger): set it last.
  const { coverPhotoId, ...g } = over;
  await db.insert(schema.galleries).values([
    {
      id: G,
      driveFolderId: "folder-secret-r",
      slug: "boda-r",
      title: "Boda R",
      clientName: "Cliente Secreto",
      status: "published",
      ...g,
    },
    {
      id: G2,
      driveFolderId: "folder-other",
      slug: "otra-r",
      title: "Otra",
      status: "published",
    },
  ]);
  await db.insert(schema.photos).values([
    {
      id: P1,
      galleryId: G,
      baseName: "A",
      driveHighresId: "HI-SECRET-1",
      driveWmId: "WM-SECRET-1",
      driveThumbWmId: "TWM-SECRET-1",
      variantVersions: JSON.stringify({
        highres: "v",
        wm: "v",
        thumbWm: "v",
      }),
      width: 3000,
      height: 2000,
      sort: 0,
    },
    {
      id: P2,
      galleryId: G,
      baseName: "B",
      driveHighresId: "HI-SECRET-2",
      variantVersions: JSON.stringify({ highres: "v" }),
      width: 2000,
      height: 3000,
      sort: 1,
    },
    {
      id: P3,
      galleryId: G,
      baseName: "C",
      driveHighresId: "HI-SECRET-3",
      width: 2000,
      height: 3000,
      sort: 2,
    },
    {
      id: PX,
      galleryId: G2,
      baseName: "X",
      driveHighresId: "HI-SECRET-X",
      sort: 0,
    },
  ]);
  if (coverPhotoId)
    await db
      .update(schema.galleries)
      .set({ coverPhotoId })
      .where(eq(schema.galleries.id, G));
}

const post = (
  fields: Record<string, string | Blob>,
  init: RequestInit = {},
) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return new Request(`http://localhost/admin/g/${G}`, {
    method: "POST",
    body,
    ...init,
  });
};
const act = (fields: Record<string, string | Blob>, en: Env = e) =>
  galleryAction(post(fields), en, G);
const row = async () =>
  (
    await db.select().from(schema.galleries).where(eq(schema.galleries.id, G))
  )[0]!;
const status = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (x) {
    return (x as Response).status;
  }
  return 200;
};

describe("migration 0017: mobile cover columns", () => {
  it("adds nullable cover_photo_id_mobile and mobile focal columns (null by default)", async () => {
    await seed();
    const r = await row();
    expect(r.coverPhotoIdMobile).toBeNull();
    expect(r.coverFocusMobileX).toBeNull();
    expect(r.coverFocusMobileY).toBeNull();
  });

  it("CHECK keeps the mobile focal point within 0-100", async () => {
    await seed();
    for (const v of [-0.1, 100.1, 1000]) {
      await expect(
        env.DB.prepare(
          "UPDATE galleries SET cover_focus_mobile_x = ? WHERE id = ?",
        )
          .bind(v, G)
          .run(),
      ).rejects.toThrow();
      await expect(
        env.DB.prepare(
          "UPDATE galleries SET cover_focus_mobile_y = ? WHERE id = ?",
        )
          .bind(v, G)
          .run(),
      ).rejects.toThrow();
    }
    await env.DB.prepare(
      "UPDATE galleries SET cover_focus_mobile_x = 0, cover_focus_mobile_y = 100 WHERE id = ?",
    )
      .bind(G)
      .run();
    expect((await row()).coverFocusMobileY).toBe(100);
  });

  it("the mobile cover must be a photo of the same gallery (update and insert)", async () => {
    await seed();
    await expect(
      env.DB.prepare(
        "UPDATE galleries SET cover_photo_id_mobile = ? WHERE id = ?",
      )
        .bind(PX, G)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title, cover_photo_id_mobile) VALUES ('g-new','f-new','s-new','T',?)",
      )
        .bind(P1)
        .run(),
    ).rejects.toThrow();
    await env.DB.prepare(
      "UPDATE galleries SET cover_photo_id_mobile = ? WHERE id = ?",
    )
      .bind(P2, G)
      .run();
    expect((await row()).coverPhotoIdMobile).toBe(P2);
  });

  it("deleting the mobile cover photo clears the mobile cover and its focal point", async () => {
    await seed();
    await env.DB.prepare(
      "UPDATE galleries SET cover_photo_id_mobile = ?, cover_focus_mobile_x = 10, cover_focus_mobile_y = 20 WHERE id = ?",
    )
      .bind(P2, G)
      .run();
    await db.delete(schema.photos).where(eq(schema.photos.id, P2));
    const r = await row();
    expect(r.coverPhotoIdMobile).toBeNull();
    expect(r.coverFocusMobileX).toBeNull();
    expect(r.coverFocusMobileY).toBeNull();
  });
});

describe("admin: per-device cover (intent cover/focus with device)", () => {
  it("sets the mobile cover without touching the desktop one, and resets the mobile focus", async () => {
    await seed({ coverPhotoId: P1, coverFocusX: 30, coverFocusY: 40 });
    await env.DB.prepare(
      "UPDATE galleries SET cover_photo_id_mobile = ?, cover_focus_mobile_x = 5, cover_focus_mobile_y = 6 WHERE id = ?",
    )
      .bind(P3, G)
      .run();
    const r = await act({ intent: "cover", device: "mobile", photoId: P2 });
    expect(r.ok).toBe(true);
    const g = await row();
    expect(g.coverPhotoIdMobile).toBe(P2);
    expect([g.coverFocusMobileX, g.coverFocusMobileY]).toEqual([null, null]);
    expect(g.coverPhotoId).toBe(P1);
    expect([g.coverFocusX, g.coverFocusY]).toEqual([30, 40]);
  });

  it("an empty mobile photoId removes the mobile cover (falls back to desktop)", async () => {
    await seed();
    await act({ intent: "cover", device: "mobile", photoId: P2 });
    const r = await act({ intent: "cover", device: "mobile", photoId: "" });
    expect(r.ok).toBe(true);
    expect((await row()).coverPhotoIdMobile).toBeNull();
  });

  it("changing the desktop cover keeps the mobile cover", async () => {
    await seed();
    await act({ intent: "cover", device: "mobile", photoId: P2 });
    await act({ intent: "cover", photoId: P3 });
    await act({ intent: "cover", device: "desktop", photoId: P1 });
    const g = await row();
    expect(g.coverPhotoId).toBe(P1);
    expect(g.coverPhotoIdMobile).toBe(P2);
  });

  it("refuses a photo of another gallery, a hidden photo and an unknown id", async () => {
    await seed();
    await db
      .update(schema.photos)
      .set({ missingSince: "2026-01-01T00:00:00Z" })
      .where(eq(schema.photos.id, P3));
    for (const photoId of [PX, P3, "nope", `${P1} `]) {
      const r = await act({ intent: "cover", device: "mobile", photoId });
      expect(r.ok).toBe(false);
    }
    expect((await row()).coverPhotoIdMobile).toBeNull();
  });

  it("refuses an unknown device and non-string fields (type confusion)", async () => {
    await seed({ coverPhotoId: P1 });
    for (const fields of [
      { intent: "cover", device: "tablet", photoId: P2 },
      { intent: "cover", device: "MOBILE", photoId: P2 },
      { intent: "cover", device: new Blob(["mobile"]), photoId: P2 },
      { intent: "cover", device: "mobile", photoId: new Blob([P2]) },
      { intent: "cover", photoId: new Blob([""]) },
      { intent: "focus", device: "phone", focusX: "1", focusY: "2" },
    ] as Record<string, string | Blob>[]) {
      const r = await act(fields);
      expect(r.ok, JSON.stringify(Object.keys(fields))).toBe(false);
    }
    const g = await row();
    expect(g.coverPhotoId).toBe(P1);
    expect(g.coverPhotoIdMobile).toBeNull();
    expect(g.coverFocusX).toBeNull();
  });

  it("saves the mobile focal point separately (validated like the desktop one)", async () => {
    await seed({ coverFocusX: 11, coverFocusY: 12 });
    await act({ intent: "cover", device: "mobile", photoId: P2 });
    const r = await act({
      intent: "focus",
      device: "mobile",
      focusX: "20.04",
      focusY: "80",
    });
    expect(r.ok).toBe(true);
    let g = await row();
    expect([g.coverFocusMobileX, g.coverFocusMobileY]).toEqual([20, 80]);
    expect([g.coverFocusX, g.coverFocusY]).toEqual([11, 12]);
    for (const [x, y] of [
      ["101", "5"],
      ["5", "-1"],
      ["NaN", "5"],
      ["0x10", "5"],
      ["5", ""],
    ]) {
      const bad = await act({
        intent: "focus",
        device: "mobile",
        focusX: x,
        focusY: y,
      });
      expect(bad.ok).toBe(false);
    }
    g = await row();
    expect([g.coverFocusMobileX, g.coverFocusMobileY]).toEqual([20, 80]);
    // Both empty = centered.
    await act({ intent: "focus", device: "mobile", focusX: "", focusY: "" });
    g = await row();
    expect([g.coverFocusMobileX, g.coverFocusMobileY]).toEqual([null, null]);
  });

  it("refuses a mobile focal point while there is no (visible) mobile cover", async () => {
    await seed();
    const r = await act({
      intent: "focus",
      device: "mobile",
      focusX: "20",
      focusY: "20",
    });
    expect(r.ok).toBe(false);
    expect((await row()).coverFocusMobileX).toBeNull();
  });

  it("is admin only and refuses cross-site posts", async () => {
    await seed();
    expect(
      await status(
        act({ intent: "cover", device: "mobile", photoId: P2 }, nonAdmin),
      ),
    ).toBe(401);
    expect(
      await status(
        galleryAction(
          post(
            { intent: "cover", device: "mobile", photoId: P2 },
            { headers: { "Sec-Fetch-Site": "cross-site" } },
          ),
          e,
          G,
        ),
      ),
    ).toBe(403);
    expect((await row()).coverPhotoIdMobile).toBeNull();
  });

  it("the editor gets the mobile cover only while it is visible", async () => {
    await seed();
    await act({ intent: "cover", device: "mobile", photoId: P2 });
    await act({ intent: "focus", device: "mobile", focusX: "1", focusY: "2" });
    let d = (await loadGalleryEdit(e, G))!;
    expect(d.gallery.coverPhotoIdMobile).toBe(P2);
    expect(d.gallery.coverFocusMobile).toEqual({ x: 1, y: 2 });
    await db
      .update(schema.photos)
      .set({ missingSince: "2026-01-01T00:00:00Z" })
      .where(eq(schema.photos.id, P2));
    d = (await loadGalleryEdit(e, G))!;
    expect(d.gallery.coverPhotoIdMobile).toBeNull();
  });
});

const visitReq = (cookie?: string, ip = "203.0.113.9") =>
  new Request("http://localhost/boda-r", {
    headers: {
      "Sec-Fetch-Mode": "navigate",
      "CF-Connecting-IP": ip,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

describe("public payload: mobile cover", () => {
  it("carries the visible mobile cover id and its focal point, nothing else new", async () => {
    await seed({ coverPhotoId: P1 });
    await act({ intent: "cover", device: "mobile", photoId: P2 });
    await act({
      intent: "focus",
      device: "mobile",
      focusX: "25",
      focusY: "75",
    });
    const res = await loadGallery(visitReq(), "boda-r", e);
    expect(res.data.state).toBe("open");
    if (res.data.state !== "open") return;
    expect(res.data.gallery.coverPhotoIdMobile).toBe(P2);
    expect(res.data.gallery.coverFocusMobile).toEqual({ x: 25, y: 75 });
    // The mobile cover photo is in the visible photo list (so it has its ?v=).
    expect(res.data.photos.some((p) => p.id === P2 && p.v)).toBe(true);
    const s = JSON.stringify(res.data);
    for (const leak of [
      "Cliente Secreto",
      "SECRET",
      "folder-secret",
      "pbkdf2",
      "clientName",
      "pinHash",
    ])
      expect(s).not.toContain(leak);
  });

  it("a hidden mobile cover falls back to the desktop one (null)", async () => {
    await seed({ coverPhotoId: P1 });
    await act({ intent: "cover", device: "mobile", photoId: P2 });
    await db
      .update(schema.photos)
      .set({ missingSince: "2026-01-01T00:00:00Z" })
      .where(eq(schema.photos.id, P2));
    const res = await loadGallery(visitReq(), "boda-r", e);
    if (res.data.state !== "open") throw new Error("not open");
    expect(res.data.gallery.coverPhotoIdMobile).toBeNull();
    expect(res.data.gallery.coverFocusMobile).toBeNull();
  });

  it("Prueba: a mobile cover without preview-wm is dropped (never a clean or broken image)", async () => {
    await seed({ coverPhotoId: P1, mode: "proofing" });
    await act({ intent: "cover", device: "mobile", photoId: P2 });
    const res = await loadGallery(visitReq(), "boda-r", e);
    if (res.data.state !== "open") throw new Error("not open");
    expect(res.data.gallery.coverPhotoIdMobile).toBeNull();
    // With preview-wm it is kept, and /img serves the watermarked file.
    await act({ intent: "cover", device: "mobile", photoId: P1 });
    const res2 = await loadGallery(visitReq(), "boda-r", e);
    if (res2.data.state !== "open") throw new Error("not open");
    expect(res2.data.gallery.coverPhotoIdMobile).toBe(P1);
    const img = await serveImage(
      visitReq(),
      { photoId: P1, variant: "view-lg" },
      e,
      ctx,
      { drive: noDrive },
    );
    expect(img.status).toBe(302);
    expect(img.headers.get("Location")).toContain("/2048/"); // mock wm file
  });

  it("a PIN-locked gallery exposes no cover ids and the mobile cover is not fetchable", async () => {
    await seed({ coverPhotoId: P1, pinHash: "pbkdf2$100000$aaa$bbb" });
    await act({ intent: "cover", device: "mobile", photoId: P2 });
    const res = await loadGallery(visitReq(), "boda-r", e);
    expect(res.data.state).toBe("locked");
    const s = JSON.stringify(res.data);
    expect(s).not.toContain(P2);
    expect(s).not.toContain(P1);
    for (const variant of ["thumb", "view-sm", "view-lg"]) {
      const img = await serveImage(
        visitReq(),
        { photoId: P2, variant },
        e,
        ctx,
        { drive: noDrive },
      );
      expect(img.status).toBe(404);
    }
  });

  it("a draft gallery does not serve the mobile cover publicly", async () => {
    await seed({ status: "draft" });
    await act({ intent: "cover", device: "mobile", photoId: P2 });
    const img = await serveImage(
      visitReq(),
      { photoId: P2, variant: "view-lg" },
      e,
      ctx,
      { drive: noDrive },
    );
    expect(img.status).toBe(404);
  });
});

describe("admin image variant thumb-wm (admin preview of a Prueba grid)", () => {
  it("admin gets the watermarked thumb; the public route 404s; non-admin 401", async () => {
    await seed({ mode: "proofing" });
    const req = new Request(`http://localhost/admin/img/${P1}/thumb-wm`);
    const r = await serveAdminImage(
      req,
      { photoId: P1, variant: "thumb-wm" },
      e,
      ctx,
      { drive: noDrive },
    );
    expect(r.status).toBe(302);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    const pub = await serveImage(
      visitReq(),
      { photoId: P1, variant: "thumb-wm" },
      e,
      ctx,
      { drive: noDrive },
    );
    expect(pub.status).toBe(404);
    expect(
      await status(
        serveAdminImage(
          req,
          { photoId: P1, variant: "thumb-wm" },
          nonAdmin,
          ctx,
          { drive: noDrive },
        ),
      ),
    ).toBe(401);
    // No thumb-wm and no preview-wm: 404, never a clean fallback.
    const none = await serveAdminImage(
      new Request(`http://localhost/admin/img/${P2}/thumb-wm`),
      { photoId: P2, variant: "thumb-wm" },
      e,
      ctx,
      { drive: noDrive },
    );
    expect(none.status).toBe(404);
  });
});

async function counts() {
  const one = async (t: string) =>
    (
      await env.DB.prepare(`SELECT count(*) AS n FROM ${t}`).first<{
        n: number;
      }>()
    )?.n ?? 0;
  return {
    views: await one("gallery_views"),
    visitors: await one("visitors"),
    downloads: await one("downloads"),
    favorites: await one("favorites"),
    rateLimits: await one("rate_limits"),
  };
}

describe("admin preview route /admin/g/:id/preview", () => {
  const paths = [
    `/admin/g/${G}/preview`,
    `/ADMIN/G/${G}/PREVIEW`,
    `/Admin/g/${G}/Preview`,
    `/admin/g/${G}/preview.data`,
    `/admin/g/${G}/preview.data?_routes=routes%2Fadmin.g.%24id.preview`,
    `/ADMIN/g/${G}/PREVIEW.DATA`,
    `/admin/g/${G}/preview/`,
  ];

  it("401 without the admin JWT, for every path variant (also .data)", async () => {
    await seed({ status: "draft", pinHash: "pbkdf2$100000$aaa$bbb" });
    for (const p of paths) {
      expect(
        await status(
          previewData(new Request(`http://localhost${p}`), nonAdmin, G),
        ),
        p,
      ).toBe(401);
      // A forged email header without a valid JWT is not enough either.
      expect(
        await status(
          previewData(
            new Request(`http://localhost${p}`, {
              headers: {
                "Cf-Access-Authenticated-User-Email": "admin@example.com",
                "Cf-Access-Jwt-Assertion": "x.y.z",
                Cookie: "CF_Authorization=x.y.z",
              },
            }),
            nonAdmin,
            G,
          ),
        ),
        p,
      ).toBe(401);
    }
  });

  it("dev admin bypass only on localhost (never on the public host)", async () => {
    await seed({ status: "draft" });
    expect(
      await status(
        previewData(
          new Request(`https://gallery.381studios.ar/admin/g/${G}/preview`),
          e,
          G,
        ),
      ),
    ).toBe(401);
  });

  it("404 for an unknown gallery (after the admin check)", async () => {
    await seed();
    expect(
      await status(
        previewData(new Request("http://localhost/admin/g/x/preview"), e, "x"),
      ),
    ).toBe(404);
    expect(
      await status(
        previewData(
          new Request("http://localhost/admin/g/x/preview"),
          nonAdmin,
          "x",
        ),
      ),
    ).toBe(401);
  });

  it("shows a draft, PIN-protected or archived gallery to the admin, without leaks", async () => {
    for (const over of [
      { status: "draft" as const, pinHash: "pbkdf2$100000$aaa$bbb" },
      { status: "archived" as const },
      { status: "published" as const, expiresAt: "2001-01-01T00:00:00Z" },
    ]) {
      await db.delete(schema.galleries);
      await seed({ coverPhotoId: P1, ...over });
      const d = await previewData(
        new Request(`http://localhost/admin/g/${G}/preview`),
        e,
        G,
      );
      expect(d.gallery.title).toBe("Boda R");
      expect(d.photos.map((p) => p.id)).toEqual([P1, P2, P3]);
      expect(d.gallery.coverPhotoId).toBe(P1);
      const s = JSON.stringify(d);
      for (const leak of [
        "Cliente Secreto",
        "SECRET",
        "folder-secret",
        "pbkdf2",
        "pinHash",
        "clientName",
      ])
        expect(s).not.toContain(leak);
    }
  });

  it("has no side effects: no views, visitors, sessions, downloads, favourites or rate-limit rows", async () => {
    await seed({ status: "published" });
    const before = await counts();
    const req = new Request(`http://localhost/admin/g/${G}/preview`, {
      headers: {
        "Sec-Fetch-Mode": "navigate",
        "CF-Connecting-IP": "203.0.113.10",
      },
    });
    const d = await previewData(req, e, G);
    expect(JSON.stringify(d)).not.toMatch(/set-?cookie/i);
    expect(await counts()).toEqual(before);
    // Sanity: a real public visit does log a view (fresh IP: no dedupe).
    await loadGallery(visitReq(undefined, "198.51.100.77"), "boda-r", e);
    expect((await counts()).views).toBe(before.views + 1);
  });

  it("answers private, no-store and noindex (document and .data)", () => {
    const h = new Headers(previewHeaders());
    expect(h.get("Cache-Control")).toBe("private, no-store");
    expect(h.get("X-Robots-Tag")).toMatch(/noindex/);
    expect(h.get("Set-Cookie")).toBeNull();
    const m = previewMeta();
    expect(m).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });
});

describe("public home and OG keep using the desktop cover", () => {
  it("og cover is the desktop cover even with a mobile cover set", async () => {
    await seed({ coverPhotoId: P1 });
    await act({ intent: "cover", device: "mobile", photoId: P2 });
    const res = await loadGallery(visitReq(), "boda-r", e);
    if (res.data.state !== "open") throw new Error("not open");
    expect(res.data.og?.coverId).toBe(P1);
    const n = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.galleries);
    expect(n[0]!.n).toBe(2);
  });
});
