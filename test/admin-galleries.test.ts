import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import {
  gallerySessionCookie,
  pinFingerprint,
  readGallerySession,
} from "../app/lib/server/auth";
import { verifyPin } from "../app/lib/server/crypto";
import {
  REORDER_CHUNK,
  galleryAction,
  listGalleries,
  loadGalleryEdit,
  photoSetVersion,
} from "../app/lib/server/admin-galleries";
import { adminIndexData } from "../app/routes/admin._index";
import { editData } from "../app/routes/admin.g.$id";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const nonAdmin = { ...e, ALLOW_DEV_ADMIN: "0" } as Env;
const db = getDb(env);

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.downloads);
  await db.delete(schema.galleryViews);
  await db.delete(schema.galleries);
});

async function gallery(
  over: Partial<typeof schema.galleries.$inferInsert> = {},
) {
  const id = over.id ?? uid();
  await db.insert(schema.galleries).values({
    id,
    driveFolderId: `drive-folder-${id}`,
    slug: `slug-${id.slice(-4)}`,
    title: "Boda",
    status: "draft",
    ...over,
  });
  return id;
}
async function photos(
  galleryId: string,
  count: number,
  over: Partial<typeof schema.photos.$inferInsert> = {},
  set = "Highlights",
) {
  const ids: string[] = [];
  const rows = [];
  for (let i = 0; i < count; i++) {
    const id = uid();
    ids.push(id);
    rows.push({
      id,
      galleryId,
      setName: set,
      baseName: `IMG_${id.slice(-8)}`,
      driveHighresId: `drive-hr-${id}`,
      sort: i,
      ...over,
    });
  }
  for (let i = 0; i < rows.length; i += 6)
    await db.insert(schema.photos).values(rows.slice(i, i + 6));
  return ids;
}
const row = async (id: string) =>
  (
    await db.select().from(schema.galleries).where(eq(schema.galleries.id, id))
  )[0];

const post = (
  fields: Record<string, string>,
  headers: HeadersInit = {},
  id = "x",
) =>
  new Request(`http://localhost/admin/g/${id}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  });
const act = (id: string, fields: Record<string, string>, envx: Env = e) =>
  galleryAction(post(fields, {}, id), envx, id);
const status = async (p: Promise<unknown>) =>
  ((await p.catch((x) => x)) as Response).status;

describe("listGalleries", () => {
  it("counts visible photos, per-photo downloads (no bulk headers) and views", async () => {
    const g = await gallery({ slug: "a" });
    const other = await gallery({ slug: "b" });
    const ps = await photos(g, 3);
    await db
      .update(schema.photos)
      .set({ missingSince: "2026-01-01T00:00:00Z" })
      .where(eq(schema.photos.id, ps[2]));
    await photos(other, 5);
    await db.insert(schema.downloads).values([
      { galleryId: g, photoId: ps[0], variant: "web", kind: "single" },
      { galleryId: g, photoId: ps[1], variant: "web", kind: "bulk" },
      { galleryId: g, photoId: null, variant: "web", kind: "bulk" },
      { galleryId: other, photoId: null, variant: "web", kind: "bulk" },
      { galleryId: other, photoId: "p", variant: "web", kind: "single" },
    ]);
    await db
      .insert(schema.galleryViews)
      .values([
        { galleryId: g },
        { galleryId: g },
        { galleryId: g },
        { galleryId: other },
      ]);
    const rows = await listGalleries(env, "todas");
    const r = rows.find((x) => x.id === g)!;
    expect(r.photoCount).toBe(2);
    expect(r.downloads).toBe(2);
    expect(r.views).toBe(3);
    const o = rows.find((x) => x.id === other)!;
    expect(o.photoCount).toBe(5);
    expect(o.downloads).toBe(1);
    expect(o.views).toBe(1);
  });

  it("issue badge counts entries plus the truncated summary", async () => {
    const g = await gallery({
      syncIssuesJson: JSON.stringify([
        { type: "missing_web", set: null, name: "a" },
        { type: "missing_web", set: null, name: "b" },
        { truncated: 5 },
      ]),
    });
    const r = (await listGalleries(env, "todas")).find((x) => x.id === g)!;
    expect(r.issueCount).toBe(7);
    const none = await gallery({ syncIssuesJson: "{corrupt" });
    expect(
      (await listGalleries(env, "todas")).find((x) => x.id === none)!
        .issueCount,
    ).toBe(0);
  });

  it("cover: chosen visible photo, else first visible photo, else null", async () => {
    const g = await gallery();
    const ps = await photos(g, 3);
    await db
      .update(schema.photos)
      .set({ missingSince: "2026-01-01T00:00:00Z" })
      .where(eq(schema.photos.id, ps[0]));
    const find = async () =>
      (await listGalleries(env, "todas")).find((x) => x.id === g)!.coverPhotoId;
    expect(await find()).toBe(ps[1]);
    await db
      .update(schema.galleries)
      .set({ coverPhotoId: ps[2] })
      .where(eq(schema.galleries.id, g));
    expect(await find()).toBe(ps[2]);
    const empty = await gallery();
    expect(
      (await listGalleries(env, "todas")).find((x) => x.id === empty)!
        .coverPhotoId,
    ).toBeNull();
  });

  it("non-archived first; filters; expired flag; no drive ids leak", async () => {
    const arch = await gallery({ status: "archived", title: "Z" });
    const pub = await gallery({ status: "published" });
    const dra = await gallery({ status: "draft" });
    const exp = await gallery({
      status: "published",
      expiresAt: "2020-01-01T00:00:00Z",
    });
    const todas = await listGalleries(env, "todas");
    expect(todas.at(-1)!.id).toBe(arch);
    expect(todas).toHaveLength(4);
    expect(
      (await listGalleries(env, "publicadas")).map((r) => r.id).sort(),
    ).toEqual([pub, exp].sort());
    expect((await listGalleries(env, "borradores")).map((r) => r.id)).toEqual([
      dra,
    ]);
    expect((await listGalleries(env, "archivadas")).map((r) => r.id)).toEqual([
      arch,
    ]);
    expect(todas.find((r) => r.id === exp)!.expired).toBe(true);
    expect(todas.find((r) => r.id === pub)!.expired).toBe(false);
    expect(JSON.stringify(todas)).not.toContain("drive-folder");
  });

  it("adminIndexData: 401 for non-admin, honours ?estado", async () => {
    await gallery({ status: "draft" });
    await gallery({ status: "published" });
    expect(
      await status(
        adminIndexData(new Request("http://x.test/admin"), nonAdmin),
      ),
    ).toBe(401);
    const d = await adminIndexData(
      new Request("http://localhost/admin?estado=borradores"),
      e,
    );
    expect(d.filter).toBe("borradores");
    expect(d.galleries).toHaveLength(1);
    expect(d.total).toBe(2);
  });
});

describe("loadGalleryEdit / editData", () => {
  it("401 non-admin, 404 unknown id", async () => {
    const g = await gallery();
    expect(
      await status(
        editData(new Request("http://x.test/admin/g/" + g), nonAdmin, g),
      ),
    ).toBe(401);
    expect(
      await status(
        editData(new Request("http://localhost/admin/g/none"), e, "none"),
      ),
    ).toBe(404);
  });

  it("exposes form values, hasPin, no hashes or drive ids, expiry in BA local", async () => {
    const g = await gallery({
      pinHash: "pbkdf2$100000$aaa$bbb",
      expiresAt: "2027-01-01T02:30:00Z",
      clientName: "Ana",
      eventDate: "2026-11-01",
    });
    const ps = await photos(g, 2);
    await db
      .update(schema.photos)
      .set({ driveWmId: "wm-secret" })
      .where(eq(schema.photos.id, ps[0]));
    const d = await editData(
      new Request("http://localhost/admin/g/" + g),
      e,
      g,
    );
    expect(d.gallery.hasPin).toBe(true);
    expect(d.gallery.expires).toEqual({ date: "2026-12-31", time: "23:30" });
    expect(d.gallery.clientName).toBe("Ana");
    expect(d.hasWmFiles).toBe(true);
    expect(d.photos).toHaveLength(2);
    const s = JSON.stringify(d);
    expect(s).not.toContain("pbkdf2");
    expect(s).not.toContain("drive-");
    expect(s).not.toContain("wm-secret");
    expect(s).not.toContain("pinHash");
  });

  it("photos ordered by set, sort; version changes with the photo set only", async () => {
    const g = await gallery();
    const a = await photos(g, 3, {}, "B");
    await photos(g, 1, { baseName: "Z" }, "A");
    const d1 = await loadGalleryEdit(env, g);
    expect(d1!.photos[0].set).toBe("A");
    expect(d1!.photos.slice(1).map((p) => p.id)).toEqual(a);
    await db
      .update(schema.photos)
      .set({ sort: 99 })
      .where(eq(schema.photos.id, a[0]));
    const d2 = await loadGalleryEdit(env, g);
    expect(d2!.version).toBe(d1!.version);
    await db
      .update(schema.photos)
      .set({ missingSince: "2026-01-01T00:00:00Z" })
      .where(eq(schema.photos.id, a[1]));
    expect((await loadGalleryEdit(env, g))!.version).not.toBe(d1!.version);
    expect(await photoSetVersion(["a", "b"])).toBe(
      await photoSetVersion(["b", "a"]),
    );
  });

  it("groups sync issues", async () => {
    const g = await gallery({
      syncIssuesJson: JSON.stringify([
        { type: "missing_web", set: null, name: "IMG_1" },
        { type: "duplicate", set: "S", name: "IMG_2" },
      ]),
    });
    const d = await loadGalleryEdit(env, g);
    expect(d!.issues.groups.map((x) => x.type).sort()).toEqual([
      "duplicate",
      "missing_web",
    ]);
  });
});

describe("guards on every action", () => {
  const intents: Record<string, string>[] = [
    { intent: "details", title: "x", slug: "xx" },
    { intent: "flags" },
    { intent: "status", to: "publish" },
    { intent: "pin", mode: "remove" },
    { intent: "cover", photoId: "" },
    { intent: "reorder", version: "v", order: "{}" },
  ];
  for (const f of intents) {
    it(`${f.intent}: 401 non-admin, 403 cross-site, no writes`, async () => {
      const g = await gallery({ title: "Intacta", slug: "intacta" });
      expect(await status(act(g, f, nonAdmin))).toBe(401);
      expect(
        await status(
          galleryAction(post(f, { "Sec-Fetch-Site": "cross-site" }, g), e, g),
        ),
      ).toBe(403);
      expect(
        await status(
          galleryAction(post(f, { Origin: "https://evil.test" }, g), e, g),
        ),
      ).toBe(403);
      expect((await row(g))!.title).toBe("Intacta");
    });
  }
  it("404 for unknown gallery, unknown intent is an inline error", async () => {
    expect(await status(act("nope", { intent: "flags" }))).toBe(404);
    const g = await gallery();
    const r = await act(g, { intent: "zzz" });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe("details action", () => {
  const ok = (over: Record<string, string> = {}) => ({
    intent: "details",
    title: "Nueva",
    slug: "nueva",
    clientName: "Ana",
    eventDate: "2026-11-01",
    expiresDate: "",
    expiresTime: "",
    ...over,
  });

  it("saves trimmed values", async () => {
    const g = await gallery();
    const r = await act(g, ok({ title: "  Nueva boda  " }));
    expect(r.ok).toBe(true);
    const x = (await row(g))!;
    expect([x.title, x.slug, x.eventDate]).toEqual([
      "Nueva boda",
      "nueva",
      "2026-11-01",
    ]);
  });

  it("T6.46: the legacy free-text client is never written or validated by the details form", async () => {
    const g = await gallery({ clientName: "Legacy Ana" });
    const r = await act(
      g,
      ok({ clientName: "Hacked\u202E" + "x".repeat(300) }),
    );
    expect(r.ok).toBe(true);
    expect((await row(g))!.clientName).toBe("Legacy Ana");
    const r2 = await act(g, ok({ clientName: "" }));
    expect(r2.ok).toBe(true);
    expect((await row(g))!.clientName).toBe("Legacy Ana");
  });

  it("empty client/date/expiry become null", async () => {
    const g = await gallery({
      eventDate: "2026-01-01",
      expiresAt: "2030-01-01T00:00:00Z",
    });
    const r = await act(g, ok({ eventDate: "" }));
    expect(r.ok).toBe(true);
    const x = (await row(g))!;
    expect([x.eventDate, x.expiresAt]).toEqual([null, null]);
  });

  it("title 1-120", async () => {
    const g = await gallery();
    const bad1 = await act(g, ok({ title: "   " }));
    expect(bad1.ok).toBe(false);
    expect(bad1.fieldErrors?.title).toMatch(/1 y 120/);
    const bad2 = await act(g, ok({ title: "x".repeat(121) }));
    expect(bad2.fieldErrors?.title).toBeTruthy();
    expect((await act(g, ok({ title: "x".repeat(120) }))).ok).toBe(true);
    const ctl = await act(g, ok({ title: "a\u0000b" }));
    expect(ctl.fieldErrors?.title).toBeTruthy();
  });

  it("allows ZWJ/ZWNJ but rejects bidi controls in text fields", async () => {
    const g = await gallery();
    const zwj = await act(
      g,
      ok({ title: "Fam\u{1F468}\u200D\u{1F469} a\u200Cb" }),
    );
    expect(zwj.ok).toBe(true);
    for (const c of ["\u202A", "\u202E", "\u2066", "\u2069", "\u0007"]) {
      const r = await act(g, ok({ title: `a${c}b` }));
      expect(r.fieldErrors?.title, c).toBeTruthy();
    }
    const pin = await act(g, {
      intent: "pin",
      mode: "set",
      pin: "1234\u202E56",
    });
    expect(pin.ok).toBe(false);
    expect(
      (await act(g, { intent: "pin", mode: "set", pin: "1234\u200D56" })).ok,
    ).toBe(true);
  });

  it("expiry year must be 2000-2100", async () => {
    const g = await gallery();
    for (const y of ["1999", "2101", "0001", "9999"]) {
      const r = await act(
        g,
        ok({ expiresDate: `${y}-06-01`, expiresTime: "10:00" }),
      );
      expect(r.fieldErrors?.expires, y).toBeTruthy();
    }
    for (const y of ["2000", "2100"])
      expect((await act(g, ok({ expiresDate: `${y}-06-01` }))).ok, y).toBe(
        true,
      );
  });

  it("slug UNIQUE race (pre-check bypassed) is a field error, not a 500", async () => {
    const g = await gallery({ slug: "mine" });
    const DB = env.DB;
    const racy = {
      prepare: (q: string) => {
        const st = DB.prepare(q);
        if (!/COLLATE NOCASE/i.test(q)) return st;
        return new Proxy(st, {
          get(t, k) {
            if (k === "bind")
              return (...a: unknown[]) => {
                const b = t.bind(...a);
                return new Proxy(b, {
                  get(t2, k2) {
                    const v = Reflect.get(t2, k2) as unknown;
                    if (typeof v !== "function") return v;
                    return async (...x: unknown[]) => {
                      const out = await (
                        v as (...a: unknown[]) => unknown
                      ).apply(t2, x);
                      // the rival insert lands right after the pre-check
                      await DB.prepare(
                        "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('rival','rival-f','taken','T')",
                      ).run();
                      return out;
                    };
                  },
                });
              };
            return Reflect.get(t, k) as unknown;
          },
        });
      },
      batch: (s: D1PreparedStatement[]) => DB.batch(s),
    } as unknown as D1Database;
    const r = await act(g, ok({ slug: "taken" }), { ...e, DB: racy } as Env);
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.slug).toMatch(/en uso/);
    expect((await row(g))!.slug).toBe("mine");
  });

  it("event date must be a real date", async () => {
    const g = await gallery();
    for (const bad of ["2026-02-30", "hoy", "2026-1-1", "2026-13-01"]) {
      const r = await act(g, ok({ eventDate: bad }));
      expect(r.fieldErrors?.eventDate, bad).toBeTruthy();
    }
  });

  it("slug: lowercased, validated, nothing saved on any failure", async () => {
    const g = await gallery({ title: "Orig", slug: "orig" });
    expect((await act(g, ok({ slug: "Mi-Boda-2026" }))).ok).toBe(true);
    expect((await row(g))!.slug).toBe("mi-boda-2026");
    for (const bad of [
      "a b",
      "-a",
      "a-",
      "a--b",
      "ñandú",
      "x".repeat(61),
      "",
      "a/b",
      "a.b",
    ]) {
      const r = await act(g, ok({ title: "Cambiado", slug: bad }));
      expect(r.ok, bad).toBe(false);
      expect(r.fieldErrors?.slug, bad).toBeTruthy();
    }
    expect((await row(g))!.title).toBe("Nueva");
  });

  it("slug: reserved names rejected (any case)", async () => {
    const g = await gallery();
    for (const bad of [
      "admin",
      "API",
      "img",
      "dl",
      "assets",
      "brand",
      "favicon.ico",
      "robots.txt",
      "manifest.webmanifest",
    ]) {
      const r = await act(g, ok({ slug: bad }));
      expect(r.fieldErrors?.slug, bad).toMatch(/reservad/i);
    }
  });

  it("slug: unique case-insensitively, own slug allowed", async () => {
    await gallery({ slug: "otra" });
    const g = await gallery({ slug: "mia" });
    const r = await act(g, ok({ slug: "OTRA" }));
    expect(r.fieldErrors?.slug).toMatch(/en uso/);
    expect((await row(g))!.slug).toBe("mia");
    expect((await act(g, ok({ slug: "MIA" }))).ok).toBe(true);
    expect((await row(g))!.slug).toBe("mia");
  });

  it("expiry: Buenos Aires local -> UTC ISO", async () => {
    const g = await gallery();
    await act(g, ok({ expiresDate: "2026-12-24", expiresTime: "18:30" }));
    expect((await row(g))!.expiresAt).toBe("2026-12-24T21:30:00Z");
    await act(g, ok({ expiresDate: "2026-12-31", expiresTime: "23:30" }));
    expect((await row(g))!.expiresAt).toBe("2027-01-01T02:30:00Z");
    // date without time = end of that day
    await act(g, ok({ expiresDate: "2026-12-24", expiresTime: "" }));
    expect((await row(g))!.expiresAt).toBe("2026-12-25T02:59:00Z");
    await act(g, ok({ expiresDate: "", expiresTime: "" }));
    expect((await row(g))!.expiresAt).toBeNull();
  });

  it("expiry: invalid or time-only rejected", async () => {
    const g = await gallery({ expiresAt: "2030-01-01T00:00:00Z" });
    for (const f of [
      { expiresDate: "2026-02-30", expiresTime: "10:00" },
      { expiresDate: "2026-01-01", expiresTime: "99:00" },
      { expiresDate: "", expiresTime: "10:00" },
    ]) {
      const r = await act(g, ok(f));
      expect(r.fieldErrors?.expires, JSON.stringify(f)).toBeTruthy();
    }
    expect((await row(g))!.expiresAt).toBe("2030-01-01T00:00:00Z");
  });
});

describe("status action", () => {
  const to = (id: string, t: string) => act(id, { intent: "status", to: t });
  it("publish draft; back to draft", async () => {
    const g = await gallery();
    expect((await to(g, "publish")).ok).toBe(true);
    expect((await row(g))!.status).toBe("published");
    expect((await to(g, "draft")).ok).toBe(true);
    expect((await row(g))!.status).toBe("draft");
  });
  it("archive remembers previous status; restore returns it and clears it", async () => {
    const g = await gallery({ status: "published" });
    expect((await to(g, "archive")).ok).toBe(true);
    let x = (await row(g))!;
    expect([x.status, x.archivedPrevStatus]).toEqual(["archived", "published"]);
    expect(x.archivedBySync).toBe(false);
    expect((await to(g, "restore")).ok).toBe(true);
    x = (await row(g))!;
    expect([x.status, x.archivedPrevStatus]).toEqual(["published", null]);

    const d = await gallery({ status: "draft" });
    await to(d, "archive");
    await to(d, "restore");
    expect((await row(d))!.status).toBe("draft");
  });
  it("restore without a remembered status goes to draft", async () => {
    const g = await gallery({ status: "archived", archivedPrevStatus: null });
    expect((await to(g, "restore")).ok).toBe(true);
    expect((await row(g))!.status).toBe("draft");
  });
  it("invalid transitions are errors and change nothing", async () => {
    const arch = await gallery({
      status: "archived",
      archivedPrevStatus: "published",
    });
    for (const t of ["publish", "draft", "archive", "bogus", ""]) {
      const r = await to(arch, t);
      expect(r.ok, t).toBe(false);
    }
    expect((await row(arch))!.status).toBe("archived");
    const pub = await gallery({ status: "published" });
    expect((await to(pub, "restore")).ok).toBe(false);
    expect((await to(pub, "publish")).ok).toBe(false);
    expect((await row(pub))!.status).toBe("published");
  });
});

describe("flags action", () => {
  const flags = {
    intent: "flags",
    allowHighres: "1",
    allowWeb: "1",
    allowIg: "1",
    allowBulk: "1",
    requireEmail: "1",
  };
  it("unchecked boxes are false", async () => {
    const g = await gallery();
    const r = await act(g, { intent: "flags", allowWeb: "1" });
    expect(r.ok).toBe(true);
    const x = (await row(g))!;
    expect([
      x.allowHighres,
      x.allowWeb,
      x.allowIg,
      x.allowBulk,
      x.requireEmail,
    ]).toEqual([false, true, false, false, false]);
    await act(g, flags);
    const y = (await row(g))!;
    expect([y.allowHighres, y.allowIg, y.allowBulk, y.requireEmail]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
  it("proofing can be chosen without preview-wm files (the UI warns)", async () => {
    const g = await gallery();
    await photos(g, 2);
    const r = await act(g, { ...flags, mode: "proofing" });
    expect(r.ok).toBe(true);
    expect((await row(g))!.mode).toBe("proofing");
  });
  it("mode switches both ways; a missing mode field keeps the current one", async () => {
    const g = await gallery();
    await photos(g, 1, { driveWmId: "w" });
    expect((await act(g, { ...flags, mode: "proofing" })).ok).toBe(true);
    expect((await row(g))!.mode).toBe("proofing");
    expect((await act(g, flags)).ok).toBe(true);
    expect((await row(g))!.mode).toBe("proofing");
    expect((await act(g, { ...flags, mode: "delivery" })).ok).toBe(true);
    expect((await row(g))!.mode).toBe("delivery");
  });
  it("an invalid mode is rejected and nothing is saved", async () => {
    const g = await gallery();
    const r = await act(g, { ...flags, mode: "yes", allowHighres: "" });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.mode).toBeTruthy();
    expect((await row(g))!.allowHighres).toBe(true);
  });
  it("in proofing the allow_* flags are preserved even though the form disables (omits) them", async () => {
    const g = await gallery();
    await act(g, { ...flags, allowIg: "", mode: "delivery" });
    expect((await row(g))!.allowIg).toBe(false);
    const r = await act(g, { intent: "flags", mode: "proofing" });
    expect(r.ok).toBe(true);
    const after = (await row(g))!;
    expect(after.allowHighres).toBe(true);
    expect(after.allowWeb).toBe(true);
    expect(after.allowBulk).toBe(true);
    expect(after.allowIg).toBe(false);
  });
  it("T6.19 loadGalleryEdit reports numeric photo/preview-wm counts from current data (and nothing else)", async () => {
    const g = await gallery();
    await photos(g, 2, { driveWmId: "wm-secret-id" });
    await photos(g, 3, {});
    const d = (await loadGalleryEdit(env, g))!;
    expect(d.photoCount).toBe(5);
    expect(d.wmCount).toBe(2);
    // after a sync drops previews, the counts follow
    await db.update(schema.photos).set({ driveWmId: null });
    const d2 = (await loadGalleryEdit(env, g))!;
    expect([d2.photoCount, d2.wmCount]).toEqual([5, 0]);
    expect(JSON.stringify(d2)).not.toContain("wm-secret-id");
  });
  it("loadGalleryEdit reports mode, wm/thumb-wm coverage and a 'falta preview-wm' issue in proofing", async () => {
    const g = await gallery();
    await photos(g, 2, {});
    await act(g, { ...flags, mode: "proofing" });
    const d = (await loadGalleryEdit(env, g))!;
    expect(d.gallery.mode).toBe("proofing");
    expect(d.hasWmFiles).toBe(false);
    expect(d.hasThumbWmFiles).toBe(false);
    const grp = d.issues.groups.find((x) => x.type === "missing_wm");
    expect(grp?.label).toBe("Falta preview-wm");
    expect(grp?.items).toHaveLength(2);
    await act(g, { ...flags, mode: "delivery" });
    expect(
      (await loadGalleryEdit(env, g))!.issues.groups.some(
        (x) => x.type === "missing_wm",
      ),
    ).toBe(false);
  });
});

describe("pin action", () => {
  const cookieFor = async (g: { id: string; pinHash: string | null }) =>
    (
      await gallerySessionCookie(
        {
          galleryId: g.id,
          unlocked: true,
          pf: await pinFingerprint(g.pinHash, env),
        },
        env,
        { secure: false },
      )
    ).split(";")[0];
  const sessionOk = async (g: string, cookie: string) => {
    const cur = (await row(g))!;
    return !!(await readGallerySession(
      new Request("http://localhost/x", { headers: { Cookie: cookie } }),
      cur,
      env,
    ));
  };

  it("set: hashed, never returned, invalidates existing sessions", async () => {
    const g = await gallery();
    const cookie = await cookieFor((await row(g))!);
    expect(await sessionOk(g, cookie)).toBe(true);
    const r = await act(g, { intent: "pin", mode: "set", pin: "123456" });
    expect(r.ok).toBe(true);
    const x = (await row(g))!;
    expect(x.pinHash).toMatch(/^pbkdf2\$/);
    expect(await verifyPin("123456", x.pinHash!)).toBe(true);
    expect(JSON.stringify(r)).not.toContain("1234");
    expect(JSON.stringify(r)).not.toContain("pbkdf2");
    expect(await sessionOk(g, cookie)).toBe(false);
  });
  it("change invalidates sessions of the previous pin", async () => {
    const g = await gallery();
    await act(g, { intent: "pin", mode: "set", pin: "123456" });
    const cookie = await cookieFor((await row(g))!);
    expect(await sessionOk(g, cookie)).toBe(true);
    await act(g, { intent: "pin", mode: "set", pin: "567890" });
    expect(await sessionOk(g, cookie)).toBe(false);
    expect(await verifyPin("567890", (await row(g))!.pinHash!)).toBe(true);
  });
  it("remove clears the hash and invalidates sessions", async () => {
    const g = await gallery();
    await act(g, { intent: "pin", mode: "set", pin: "123456" });
    const cookie = await cookieFor((await row(g))!);
    const r = await act(g, { intent: "pin", mode: "remove" });
    expect(r.ok).toBe(true);
    expect((await row(g))!.pinHash).toBeNull();
    expect(await sessionOk(g, cookie)).toBe(false);
    expect((await act(g, { intent: "pin", mode: "remove" })).ok).toBe(true);
  });
  it("length 4-32 enforced, bad modes rejected", async () => {
    const g = await gallery();
    for (const pin of ["", "123", "x".repeat(33), "12\n34"]) {
      const r = await act(g, { intent: "pin", mode: "set", pin });
      expect(r.ok, pin).toBe(false);
      expect(r.fieldErrors?.pin).toBeTruthy();
    }
    expect(
      (await act(g, { intent: "pin", mode: "set", pin: "x".repeat(32) })).ok,
    ).toBe(true);
    expect((await act(g, { intent: "pin", mode: "zzz" })).ok).toBe(false);
    expect((await act(g, { intent: "pin" })).ok).toBe(false);
  });
});

describe("cover action", () => {
  it("must be a visible photo of this gallery", async () => {
    const g = await gallery();
    const other = await gallery();
    const [p] = await photos(g, 1);
    const [hidden] = await photos(g, 1, {
      baseName: "H",
      missingSince: "2026-01-01T00:00:00Z",
    });
    const [foreign] = await photos(other, 1);
    for (const bad of [foreign, hidden, "nope"]) {
      const r = await act(g, { intent: "cover", photoId: bad });
      expect(r.ok, bad).toBe(false);
      expect(r.error).toBeTruthy();
    }
    expect((await row(g))!.coverPhotoId).toBeNull();
    expect((await act(g, { intent: "cover", photoId: p })).ok).toBe(true);
    expect((await row(g))!.coverPhotoId).toBe(p);
    expect((await row(other))!.coverPhotoId).toBeNull();
  });
  it("empty photoId clears the cover", async () => {
    const g = await gallery();
    const [p] = await photos(g, 1);
    await act(g, { intent: "cover", photoId: p });
    expect((await act(g, { intent: "cover", photoId: "" })).ok).toBe(true);
    expect((await row(g))!.coverPhotoId).toBeNull();
  });
});

describe("reorder action", () => {
  const sortOf = async (g: string) =>
    Object.fromEntries(
      (
        await db
          .select()
          .from(schema.photos)
          .where(eq(schema.photos.galleryId, g))
      ).map((p) => [p.id, p.sort]),
    );
  const send = async (
    g: string,
    order: Record<string, string[]>,
    version?: string,
    envx: Env = e,
  ) => {
    const v = version ?? (await loadGalleryEdit(env, g))!.version;
    return act(
      g,
      { intent: "reorder", version: v, order: JSON.stringify(order) },
      envx,
    );
  };

  it("writes per-set positions", async () => {
    const g = await gallery();
    const a = await photos(g, 3, {}, "A");
    const b = await photos(g, 2, {}, "B");
    const r = await send(g, { A: [a[2], a[0], a[1]], B: [b[1], b[0]] });
    expect(r.ok).toBe(true);
    const s = await sortOf(g);
    expect([s[a[2]], s[a[0]], s[a[1]]]).toEqual([0, 1, 2]);
    expect([s[b[1]], s[b[0]]]).toEqual([0, 1]);
    const d = await loadGalleryEdit(env, g);
    expect(d!.photos.filter((p) => p.set === "A").map((p) => p.id)).toEqual([
      a[2],
      a[0],
      a[1],
    ]);
  });

  it("stale version rejected with a friendly message, nothing written", async () => {
    const g = await gallery();
    const a = await photos(g, 3);
    const v = (await loadGalleryEdit(env, g))!.version;
    await photos(g, 1, { baseName: "NEW" }); // a sync added a photo
    const r = await send(g, { Highlights: [a[2], a[1], a[0]] }, v);
    expect(r.ok).toBe(false);
    expect(r.stale).toBe(true);
    expect(r.error).toMatch(/recarg/i);
    const s = await sortOf(g);
    expect([s[a[0]], s[a[1]], s[a[2]]]).toEqual([0, 1, 2]);
  });

  it("cross-gallery id rejected, neither gallery changes", async () => {
    const g = await gallery();
    const other = await gallery();
    const a = await photos(g, 3);
    const [f] = await photos(other, 1, { sort: 7 });
    const r = await send(g, { Highlights: [a[2], a[1], f] });
    expect(r.ok).toBe(false);
    const s = await sortOf(g);
    expect([s[a[0]], s[a[1]], s[a[2]]]).toEqual([0, 1, 2]);
    expect((await sortOf(other))[f]).toBe(7);
    // foreign id replacing a real one with the same count
    expect((await send(g, { Highlights: [a[0], a[1], a[2], f] })).ok).toBe(
      false,
    );
  });

  it("wrong set, duplicates, missing ids and malformed payloads rejected", async () => {
    const g = await gallery();
    const a = await photos(g, 2, {}, "A");
    const b = await photos(g, 1, { baseName: "B" }, "B");
    const bad: Array<Record<string, string[]>> = [
      { A: [a[0], a[1], b[0]], B: [] },
      { A: [a[0], a[0]], B: [b[0]] },
      { A: [a[0]], B: [b[0]] },
      { A: [a[1], a[0]] },
    ];
    for (const o of bad) expect((await send(g, o)).ok).toBe(false);
    const v = (await loadGalleryEdit(env, g))!.version;
    for (const raw of ["", "{", "[]", "null", '{"A":"x"}', '{"A":[1]}']) {
      const r = await act(g, { intent: "reorder", version: v, order: raw });
      expect(r.ok, raw).toBe(false);
    }
    const s = await sortOf(g);
    expect([s[a[0]], s[a[1]], s[b[0]]]).toEqual([0, 1, 0]);
  });

  it("writes all sorts in ONE batch of CASE updates under 100 bound params", async () => {
    const g = await gallery();
    const a = await photos(g, 300);
    const batches: number[] = [];
    const queries: string[] = [];
    const DB = env.DB;
    const spy = {
      prepare: (q: string) => {
        queries.push(q);
        return DB.prepare(q);
      },
      batch: (s: D1PreparedStatement[]) => {
        batches.push(s.length);
        return DB.batch(s);
      },
    } as unknown as D1Database;
    const version = (await loadGalleryEdit(env, g))!.version;
    const r = await act(
      g,
      {
        intent: "reorder",
        version,
        order: JSON.stringify({ Highlights: [...a].reverse() }),
      },
      { ...e, DB: spy } as Env,
    );
    expect(r.ok).toBe(true);
    expect(REORDER_CHUNK).toBe(45);
    expect(batches).toEqual([Math.ceil(300 / 45)]);
    const updates = queries.filter((q) => /^update "photos"/i.test(q));
    expect(updates.length).toBe(batches[0]);
    for (const q of updates) {
      expect(q).toMatch(/CASE/);
      expect((q.match(/\?/g) ?? []).length).toBeLessThanOrEqual(100);
    }
    const s = await sortOf(g);
    expect(s[a[299]]).toBe(0);
    expect(s[a[0]]).toBe(299);
  });

  it("unchanged order writes nothing", async () => {
    const g = await gallery();
    const a = await photos(g, 5);
    const lens: number[] = [];
    const DB = env.DB;
    const spy = {
      prepare: (q: string) => DB.prepare(q),
      batch: (s: D1PreparedStatement[]) => {
        lens.push(s.length);
        return DB.batch(s);
      },
    } as unknown as D1Database;
    const r = await send(g, { Highlights: a }, undefined, {
      ...e,
      DB: spy,
    } as Env);
    expect(r.ok).toBe(true);
    expect(lens).toEqual([]);
  });

  it("photos in sync grace period are not part of the set", async () => {
    const g = await gallery();
    const a = await photos(g, 2);
    const [m] = await photos(g, 1, {
      baseName: "M",
      missingSince: "2026-01-01T00:00:00Z",
      sort: 9,
    });
    expect((await send(g, { Highlights: [a[1], a[0]] })).ok).toBe(true);
    expect((await sortOf(g))[m]).toBe(9);
    expect(
      (
        await db
          .select()
          .from(schema.photos)
          .where(and(eq(schema.photos.galleryId, g), eq(schema.photos.id, m)))
      )[0].sort,
    ).toBe(9);
  });
});

describe("T6.21 expiry uses the configured TIMEZONE", () => {
  const ok = (over: Record<string, string> = {}) => ({
    intent: "details",
    title: "Boda",
    slug: "boda-tz",
    clientName: "",
    eventDate: "",
    expiresDate: "",
    expiresTime: "",
    ...over,
  });
  const ny = { ...e, TIMEZONE: "America/New_York" } as Env;
  it("saves local -> UTC in the zone; end of day = 23:59 local", async () => {
    const g = await gallery();
    await act(g, ok({ expiresDate: "2026-07-15", expiresTime: "18:30" }), ny);
    expect((await row(g))!.expiresAt).toBe("2026-07-15T22:30:00Z");
    await act(g, ok({ expiresDate: "2026-01-15", expiresTime: "" }), ny);
    expect((await row(g))!.expiresAt).toBe("2026-01-16T04:59:00Z");
  });
  it("loadGalleryEdit shows the stored instant in the zone", async () => {
    const g = await gallery({ expiresAt: "2026-07-15T22:30:00Z" });
    expect((await loadGalleryEdit(ny, g))!.gallery.expires).toEqual({
      date: "2026-07-15",
      time: "18:30",
    });
  });
  it("an invalid TIMEZONE falls back to Buenos Aires", async () => {
    const g = await gallery();
    const bad = { ...e, TIMEZONE: "Mars/Olympus" } as Env;
    await act(g, ok({ expiresDate: "2026-12-24", expiresTime: "18:30" }), bad);
    expect((await row(g))!.expiresAt).toBe("2026-12-24T21:30:00Z");
  });
});
