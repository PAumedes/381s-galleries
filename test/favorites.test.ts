import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, nowIso, schema } from "../app/db";
import { gallerySessionCookie, pinFingerprint } from "../app/lib/server/auth";
import { hashPin } from "../app/lib/server/crypto";
import {
  FAVORITES_MAX,
  VISITOR_MAX_PER_WINDOW,
  handleListFavorites,
  handleSetFavorite,
  handleVisitor,
} from "../app/lib/server/favorites";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000f1";
const G2 = "gggggggg-0000-0000-0000-0000000000f2";
const BASE = "https://session.test";

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM favorites"),
    env.DB.prepare("DELETE FROM visitors"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM photos"),
    env.DB.prepare("DELETE FROM galleries"),
  ]);
});

async function addGallery(
  over: Partial<typeof schema.galleries.$inferInsert> = {},
) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f1",
    slug: "boda",
    title: "Boda",
    status: "published",
    ...over,
  });
}
async function addPhoto(
  id: string,
  galleryId = G,
  over: Partial<typeof schema.photos.$inferInsert> = {},
) {
  await db.insert(schema.photos).values({
    id,
    galleryId,
    baseName: `IMG_${id}`,
    driveHighresId: `hr-${id}`,
    sort: 1,
    ...over,
  });
}

const json = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const visitorReq = (body: unknown, headers: Record<string, string> = {}) =>
  json("/api/g/boda/visitor", body, headers);
const favReq = (body: unknown, headers: Record<string, string> = {}) =>
  json("/api/g/boda/favorites", body, headers);
const listReq = (headers: Record<string, string> = {}) =>
  new Request(`${BASE}/api/g/boda/favorites`, { headers });

const cookieOf = (res: Response) =>
  res.headers.getSetCookie()[0]?.split(";")[0] ?? "";

/** Registers a visitor and returns the session cookie. */
async function register(email = "ana@example.com", ip = "1.1.1.1") {
  const res = await handleVisitor(
    visitorReq({ email, name: "Ana" }, { "CF-Connecting-IP": ip }),
    "boda",
    env,
  );
  expect(res.status).toBe(200);
  return cookieOf(res);
}
const fav = (cookie: string, photoId: string, on = true) =>
  handleSetFavorite(favReq({ photoId, on }, { Cookie: cookie }), "boda", env);
const list = async (cookie?: string) => {
  const res = await handleListFavorites(
    listReq(cookie ? { Cookie: cookie } : {}),
    "boda",
    env,
  );
  return {
    res,
    body: (await res.json()) as { visitor: unknown; favorites: string[] },
  };
};

describe("POST visitor", () => {
  it("creates a visitor, normalizes the email and sets the session cookie", async () => {
    await addGallery();
    const res = await handleVisitor(
      visitorReq({ email: "  Ana@Example.COM ", name: " Ana\u0000 B\u0007 " }),
      "boda",
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      visitor: { email: "ana@example.com", name: "Ana B" },
    });
    const rows = await db.select().from(schema.visitors);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("ana@example.com");
    const cookie = res.headers.getSetCookie()[0];
    expect(cookie).toContain("HttpOnly");
    const { body } = await list(cookieOf(res));
    expect(body.visitor).toEqual({ email: "ana@example.com", name: "Ana B" });
  });

  it("is an upsert: same email (any case) yields the same visitor row", async () => {
    await addGallery();
    await register("ana@example.com");
    await register("ANA@example.com");
    expect(await db.select().from(schema.visitors)).toHaveLength(1);
  });

  it("keeps pf/unlocked/viewed from the existing session", async () => {
    await addGallery({ pinHash: await hashPin("1234") });
    const g = (await db.select().from(schema.galleries))[0];
    const pf = await pinFingerprint(g.pinHash, env);
    const c = (
      await gallerySessionCookie(
        { galleryId: G, unlocked: true, pf, viewed: true },
        env,
        { secure: false },
      )
    ).split(";")[0];
    const res = await handleVisitor(
      visitorReq({ email: "a@b.co" }, { Cookie: c }),
      "boda",
      env,
    );
    expect(res.status).toBe(200);
    const { body } = await list(cookieOf(res));
    expect(body.visitor).toEqual({ email: "a@b.co", name: null });
    // still unlocked (listing works with PIN gallery) -> not 404
    expect((await list(cookieOf(res))).res.status).toBe(200);
  });

  it.each([
    ["missing", {}],
    ["not a string", { email: 5 }],
    ["no at", { email: "nope" }],
    ["no tld", { email: "a@b" }],
    ["spaces inside", { email: "a b@c.de" }],
    ["two ats", { email: "a@@c.de" }],
    ["too long", { email: `${"a".repeat(250)}@c.de` }],
    ["reserved anon domain", { email: "x@anon.invalid" }],
    ["control char", { email: "a\u0000@c.de" }],
  ])("rejects invalid email: %s", async (_n, body) => {
    await addGallery();
    const res = await handleVisitor(visitorReq(body), "boda", env);
    expect(res.status).toBe(400);
    expect(await db.select().from(schema.visitors)).toHaveLength(0);
  });

  it("rejects non-JSON bodies with 400 and truncates the name to 80", async () => {
    await addGallery();
    const bad = await handleVisitor(
      new Request(`${BASE}/api/g/boda/visitor`, { method: "POST", body: "x" }),
      "boda",
      env,
    );
    expect(bad.status).toBe(400);
    const res = await handleVisitor(
      visitorReq({ email: "a@b.co", name: "n".repeat(200) }),
      "boda",
      env,
    );
    expect(
      ((await res.json()) as { visitor: { name: string } }).visitor.name,
    ).toHaveLength(80);
  });

  it("unknown, draft, expired and PIN-locked all give an identical generic 404", async () => {
    await addGallery({
      slug: "draft",
      id: "gd",
      driveFolderId: "d",
      status: "draft",
    });
    await addGallery({
      slug: "old",
      id: "go",
      driveFolderId: "o",
      expiresAt: nowIso(new Date(Date.now() - 1000)),
    });
    await addGallery({
      slug: "pin",
      id: "gp",
      driveFolderId: "p",
      pinHash: await hashPin("1234"),
    });
    const out: string[] = [];
    for (const s of ["nope", "draft", "old", "pin"]) {
      const res = await handleVisitor(visitorReq({ email: "a@b.co" }), s, env);
      expect(res.status).toBe(404);
      expect(res.headers.getSetCookie()).toEqual([]);
      out.push(await res.text());
    }
    expect(new Set(out).size).toBe(1);
    expect(await db.select().from(schema.visitors)).toHaveLength(0);
  });

  it("rejects cross-site requests with 403", async () => {
    await addGallery();
    for (const h of [
      { "Sec-Fetch-Site": "cross-site" },
      { Origin: "https://evil.test" },
    ]) {
      const res = await handleVisitor(
        visitorReq({ email: "a@b.co" }, h),
        "boda",
        env,
      );
      expect(res.status).toBe(403);
    }
    expect(await db.select().from(schema.visitors)).toHaveLength(0);
  });

  it("rate limits to 10 per 10 minutes per ip+gallery, then 429; other ip unaffected", async () => {
    await addGallery();
    const h = { "CF-Connecting-IP": "9.9.9.9" };
    for (let i = 0; i < VISITOR_MAX_PER_WINDOW; i++) {
      const r = await handleVisitor(
        visitorReq({ email: `u${i}@b.co` }, h),
        "boda",
        env,
      );
      expect(r.status).toBe(200);
    }
    const blocked = await handleVisitor(
      visitorReq({ email: "z@b.co" }, h),
      "boda",
      env,
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Cache-Control")).toBe("no-store");
    const other = await handleVisitor(
      visitorReq({ email: "z@b.co" }, { "CF-Connecting-IP": "8.8.8.8" }),
      "boda",
      env,
    );
    expect(other.status).toBe(200);
  });

  it("window expiry resets the counter", async () => {
    await addGallery();
    const h = { "CF-Connecting-IP": "9.9.9.9" };
    for (let i = 0; i < VISITOR_MAX_PER_WINDOW; i++) {
      await handleVisitor(visitorReq({ email: `u${i}@b.co` }, h), "boda", env);
    }
    await env.DB.prepare("UPDATE rate_limits SET window_start = ?")
      .bind(nowIso(new Date(Date.now() - 11 * 60_000)))
      .run();
    const r = await handleVisitor(
      visitorReq({ email: "z@b.co" }, h),
      "boda",
      env,
    );
    expect(r.status).toBe(200);
  });
});

describe("GET favorites", () => {
  it("without a visitor: visitor null and no favorites", async () => {
    await addGallery();
    const { res, body } = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({ visitor: null, favorites: [] });
  });

  it("returns only visible photos' ids for the current visitor", async () => {
    await addGallery();
    await addPhoto("p1");
    await addPhoto("p2");
    const c = await register();
    await fav(c, "p1");
    await fav(c, "p2");
    await db
      .update(schema.photos)
      .set({ missingSince: nowIso() })
      .where(eq(schema.photos.id, "p2"));
    const { body } = await list(c);
    expect(body.favorites).toEqual(["p1"]);
  });

  it("IDOR: visitor A never sees visitor B's favorites", async () => {
    await addGallery();
    await addPhoto("p1");
    await addPhoto("p2");
    const a = await register("a@x.co", "1.1.1.1");
    const b = await register("b@x.co", "2.2.2.2");
    await fav(a, "p1");
    await fav(b, "p2");
    expect((await list(a)).body.favorites).toEqual(["p1"]);
    expect((await list(b)).body.favorites).toEqual(["p2"]);
    const text = JSON.stringify((await list(a)).body);
    expect(text).not.toContain("b@x.co");
  });

  it("a forged/tampered session cookie yields no visitor", async () => {
    await addGallery();
    await addPhoto("p1");
    const a = await register();
    await fav(a, "p1");
    const tampered = a.slice(0, -2) + (a.endsWith("aa") ? "bb" : "aa");
    expect((await list(tampered)).body).toEqual({
      visitor: null,
      favorites: [],
    });
  });

  it("a cookie whose visitor belongs to another gallery is ignored", async () => {
    await addGallery();
    await addGallery({ id: G2, slug: "otra", driveFolderId: "f2" });
    await db
      .insert(schema.visitors)
      .values({ id: "vx", galleryId: G2, email: "q@q.co" });
    const pf = await pinFingerprint(null, env);
    const c = (
      await gallerySessionCookie(
        { galleryId: G, unlocked: true, pf, visitorId: "vx" },
        env,
        { secure: false },
      )
    ).split(";")[0];
    expect((await list(c)).body.visitor).toBeNull();
  });

  it("unavailable/locked galleries give the same generic 404", async () => {
    await addGallery({ pinHash: await hashPin("1234") });
    const locked = await handleListFavorites(listReq(), "boda", env);
    const unknown = await handleListFavorites(listReq(), "nope", env);
    expect(locked.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await locked.text()).toBe(await unknown.text());
  });
});

describe("POST favorites", () => {
  it("adds and removes, idempotently, in the default list", async () => {
    await addGallery();
    await addPhoto("p1");
    const c = await register();
    for (let i = 0; i < 2; i++) {
      const r = await fav(c, "p1", true);
      expect(r.status).toBe(200);
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
    const rows = await db.select().from(schema.favorites);
    expect(rows).toHaveLength(1);
    expect(rows[0].listName).toBe("Favoritos");
    expect(rows[0].galleryId).toBe(G);
    for (let i = 0; i < 2; i++)
      expect((await fav(c, "p1", false)).status).toBe(200);
    expect(await db.select().from(schema.favorites)).toHaveLength(0);
  });

  it("requires a visitor when require_email is true", async () => {
    await addGallery();
    await addPhoto("p1");
    const r = await handleSetFavorite(
      favReq({ photoId: "p1", on: true }),
      "boda",
      env,
    );
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe(
      "email_required",
    );
    expect(await db.select().from(schema.favorites)).toHaveLength(0);
  });

  it("auto-creates an anonymous visitor when require_email is false", async () => {
    await addGallery({ requireEmail: false });
    await addPhoto("p1");
    const r = await handleSetFavorite(
      favReq({ photoId: "p1", on: true }),
      "boda",
      env,
    );
    expect(r.status).toBe(200);
    const v = await db.select().from(schema.visitors);
    expect(v).toHaveLength(1);
    expect(v[0].email).toMatch(/^anon-[0-9a-f-]{36}@anon\.invalid$/);
    expect(v[0].name).toBeNull();
    const c = cookieOf(r);
    expect(c).not.toBe("");
    const { body } = await list(c);
    expect(body.favorites).toEqual(["p1"]);
    expect(body.visitor).toBeNull(); // anonymous identity is never exposed
    // second favorite reuses the same visitor
    await addPhoto("p2");
    await fav(c, "p2");
    expect(await db.select().from(schema.visitors)).toHaveLength(1);
  });

  it("cross-gallery and unknown photo ids give 404", async () => {
    await addGallery();
    await addGallery({ id: G2, slug: "otra", driveFolderId: "f2" });
    await addPhoto("other", G2);
    const c = await register();
    expect((await fav(c, "other")).status).toBe(404);
    expect((await fav(c, "nope")).status).toBe(404);
    expect(await db.select().from(schema.favorites)).toHaveLength(0);
  });

  it("a photo in its sync grace period (missing_since) is 404", async () => {
    await addGallery();
    await addPhoto("p1", G, { missingSince: nowIso() });
    const c = await register();
    expect((await fav(c, "p1")).status).toBe(404);
  });

  it("validates the body", async () => {
    await addGallery();
    await addPhoto("p1");
    const c = await register();
    for (const body of [
      {},
      { photoId: 5, on: true },
      { photoId: "p1" },
      { photoId: "p1", on: "yes" },
      { photoId: "x".repeat(200), on: true },
    ]) {
      expect(
        (await handleSetFavorite(favReq(body, { Cookie: c }), "boda", env))
          .status,
      ).toBe(400);
    }
  });

  it("IDOR: toggling uses only the session's visitor", async () => {
    await addGallery();
    await addPhoto("p1");
    const a = await register("a@x.co", "1.1.1.1");
    const b = await register("b@x.co", "2.2.2.2");
    await fav(a, "p1");
    await fav(b, "p1", false); // B removing must not affect A
    expect((await list(a)).body.favorites).toEqual(["p1"]);
    // a visitorId smuggled in the body is ignored
    const [va] = await db
      .select()
      .from(schema.visitors)
      .where(eq(schema.visitors.email, "a@x.co"));
    await handleSetFavorite(
      favReq({ photoId: "p1", on: false, visitorId: va.id }, { Cookie: b }),
      "boda",
      env,
    );
    expect((await list(a)).body.favorites).toEqual(["p1"]);
  });

  it("caps favorites per visitor at 2000 (existing ones can still be removed)", async () => {
    await addGallery();
    const c = await register();
    const [v] = await db.select().from(schema.visitors);
    await addPhoto("extra");
    await addPhoto("last");
    const stmts = [];
    for (let i = 0; i < FAVORITES_MAX; i++) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id, sort) VALUES (?1, ?2, ?3, ?4, 1)",
        ).bind(`bulk${i}`, G, `B${i}`, `h${i}`),
      );
    }
    for (let i = 0; i < stmts.length; i += 90)
      await env.DB.batch(stmts.slice(i, i + 90));
    const favs = [];
    for (let i = 0; i < FAVORITES_MAX - 1; i++) {
      favs.push(
        env.DB.prepare(
          "INSERT INTO favorites (gallery_id, visitor_id, photo_id) VALUES (?1, ?2, ?3)",
        ).bind(G, v.id, `bulk${i}`),
      );
    }
    for (let i = 0; i < favs.length; i += 90)
      await env.DB.batch(favs.slice(i, i + 90));
    expect((await fav(c, "extra")).status).toBe(200); // 2000th
    const over = await fav(c, "last");
    expect(over.status).toBe(409);
    expect(((await over.json()) as { error: string }).error).toBe("limit");
    expect((await fav(c, "extra")).status).toBe(200); // idempotent re-add at the cap
    expect((await fav(c, "extra", false)).status).toBe(200);
    expect((await fav(c, "last")).status).toBe(200);
  }, 60_000);

  it("rejects cross-site with 403 and writes nothing", async () => {
    await addGallery();
    await addPhoto("p1");
    const c = await register();
    const r = await handleSetFavorite(
      favReq(
        { photoId: "p1", on: true },
        { Cookie: c, "Sec-Fetch-Site": "cross-site" },
      ),
      "boda",
      env,
    );
    expect(r.status).toBe(403);
    expect(await db.select().from(schema.favorites)).toHaveLength(0);
  });

  it("unknown / draft / PIN-locked gallery: generic 404", async () => {
    await addGallery({ pinHash: await hashPin("1234") });
    await addPhoto("p1");
    const a = await handleSetFavorite(
      favReq({ photoId: "p1", on: true }),
      "boda",
      env,
    );
    const b = await handleSetFavorite(
      favReq({ photoId: "p1", on: true }),
      "nope",
      env,
    );
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await a.text()).toBe(await b.text());
  });
});
