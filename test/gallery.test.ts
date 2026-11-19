import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, nowIso, schema } from "../app/db";
import {
  gallerySessionCookie,
  pinFingerprint,
  readGallerySession,
} from "../app/lib/server/auth";
import { hashPin } from "../app/lib/server/crypto";
import { loadGallery, unlockGallery } from "../app/lib/server/gallery";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-000000000001";
const URL_ = "https://session.test/boda-ana";

beforeAll(async () => {
  await migrateDb();
});

type GalleryRow = Partial<typeof schema.galleries.$inferInsert>;
async function addGallery(over: GalleryRow = {}) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "drive-folder-SECRET",
    slug: "boda-ana",
    title: "Boda Ana",
    status: "published",
    ...over,
  });
}
async function addPhoto(
  n: number,
  over: Partial<typeof schema.photos.$inferInsert> = {},
) {
  await db.insert(schema.photos).values({
    id: `p${n}`,
    galleryId: G,
    baseName: `IMG_${n}`,
    driveHighresId: `drive-highres-SECRET-${n}`,
    driveWebId: `drive-web-SECRET-${n}`,
    width: 3000,
    height: 2000,
    sort: n,
    ...over,
  });
}

beforeEach(async () => {
  await resetTables("gallery_views", "rate_limits", "photos", "galleries");
});

const get = (url = URL_, headers: Record<string, string> = {}, cf?: object) =>
  new Request(url, {
    headers: { "Sec-Fetch-Mode": "navigate", ...headers },
    ...(cf ? { cf } : {}),
  } as RequestInit);

async function cookieFor(
  session: { unlocked: boolean; viewed?: boolean },
  pinHash: string | null,
) {
  const pf = await pinFingerprint(pinHash, env);
  const c = await gallerySessionCookie({ galleryId: G, pf, ...session }, env, {
    secure: false,
  });
  return c.split(";")[0];
}

describe("loadGallery: states", () => {
  it("unknown, draft, archived and expired give the identical unavailable result", async () => {
    await addGallery({
      slug: "draft",
      driveFolderId: "d1",
      id: "g-d",
      status: "draft",
    });
    await addGallery({
      slug: "arch",
      driveFolderId: "d2",
      id: "g-a",
      status: "archived",
    });
    await addGallery({
      slug: "old",
      driveFolderId: "d3",
      id: "g-e",
      expiresAt: nowIso(new Date(Date.now() - 1000)),
    });
    const results = await Promise.all(
      ["nope", "draft", "arch", "old"].map((s) => loadGallery(get(), s, env)),
    );
    for (const r of results) {
      expect(r.status).toBe(404);
      expect(r.data).toEqual({ state: "unavailable" });
      expect(r.setCookie).toBeUndefined();
    }
    expect(JSON.stringify(results[1])).toBe(JSON.stringify(results[0]));
  });

  it("expires_at equal to now is expired; in the future is open", async () => {
    await addGallery({ expiresAt: nowIso(new Date(Date.now() + 3_600_000)) });
    expect((await loadGallery(get(), "boda-ana", env)).data.state).toBe("open");
    await db.update(schema.galleries).set({ expiresAt: nowIso() });
    expect((await loadGallery(get(), "boda-ana", env)).status).toBe(404);
  });

  it("matches the slug case-insensitively", async () => {
    await addGallery({ slug: "Boda-Ana" });
    const r = await loadGallery(get(), "bODA-aNA", env);
    expect(r.data.state).toBe("open");
  });

  it("PIN gallery without session is locked: title only, 200", async () => {
    await addGallery({ pinHash: await hashPin("1234") });
    await addPhoto(1);
    await db.update(schema.galleries).set({ coverPhotoId: "p1" });
    const r = await loadGallery(get(), "boda-ana", env);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({
      state: "locked",
      slug: "boda-ana",
      title: "Boda Ana",
      palette: "claro",
    });
    expect(r.setCookie).toBeUndefined();
    expect(await db.select().from(schema.galleryViews)).toHaveLength(0);
  });

  it("PIN gallery with a valid unlocked session is open", async () => {
    const pinHash = await hashPin("1234");
    await addGallery({ pinHash });
    await addPhoto(1);
    const cookie = await cookieFor({ unlocked: true }, pinHash);
    const r = await loadGallery(get(URL_, { Cookie: cookie }), "boda-ana", env);
    expect(r.data.state).toBe("open");
  });

  it("a session with unlocked=false is still locked", async () => {
    const pinHash = await hashPin("1234");
    await addGallery({ pinHash });
    const cookie = await cookieFor({ unlocked: false }, pinHash);
    const r = await loadGallery(get(URL_, { Cookie: cookie }), "boda-ana", env);
    expect(r.data.state).toBe("locked");
  });

  it("changing the PIN invalidates sessions (pf); clearing it opens the gallery", async () => {
    const oldHash = await hashPin("1234");
    await addGallery({ pinHash: oldHash });
    const cookie = await cookieFor({ unlocked: true }, oldHash);
    await db.update(schema.galleries).set({ pinHash: await hashPin("9999") });
    const r1 = await loadGallery(
      get(URL_, { Cookie: cookie }),
      "boda-ana",
      env,
    );
    expect(r1.data.state).toBe("locked");
    await db.update(schema.galleries).set({ pinHash: null });
    const r2 = await loadGallery(
      get(URL_, { Cookie: cookie }),
      "boda-ana",
      env,
    );
    expect(r2.data.state).toBe("open");
  });
});

describe("loadGallery: open data", () => {
  it("returns visible photos ordered by set then sort, with set counts", async () => {
    await addGallery({
      eventDate: "2026-03-14",
      clientName: "Ana",
      allowBulk: false,
    });
    await addPhoto(3, { setName: "Fiesta", sort: 1 });
    await addPhoto(1, { setName: "Ceremonia", sort: 2 });
    await addPhoto(2, { setName: "Ceremonia", sort: 1 });
    await addPhoto(4, { setName: "Fiesta", sort: 0, missingSince: nowIso() });
    const r = await loadGallery(get(), "boda-ana", env);
    if (r.data.state !== "open") throw new Error("expected open");
    expect(r.status).toBe(200);
    expect(r.data.photos.map((p) => p.id)).toEqual(["p2", "p1", "p3"]);
    expect(r.data.photos[0]).toEqual({
      id: "p2",
      width: 3000,
      height: 2000,
      set: "Ceremonia",
      variants: { web: true, ig: false },
      // No known Drive versions in this fixture: no token (no immutable caching).
    });
    expect(r.data.gallery).toMatchObject({
      title: "Boda Ana",
      eventDate: "2026-03-14",
      allowBulk: false,
      sets: [
        { name: "Ceremonia", count: 2 },
        { name: "Fiesta", count: 1 },
      ],
    });
  });

  it("cover: explicit, null -> first photo, hidden -> first photo, none -> null", async () => {
    await addGallery();
    await addPhoto(1);
    await addPhoto(2);
    await db.update(schema.galleries).set({ coverPhotoId: "p2" });
    const cover = async () => {
      const r = await loadGallery(get(), "boda-ana", env);
      if (r.data.state !== "open") throw new Error("expected open");
      return r.data.gallery.coverPhotoId;
    };
    expect(await cover()).toBe("p2");
    await db.update(schema.galleries).set({ coverPhotoId: null });
    expect(await cover()).toBe("p1");
    await db
      .update(schema.photos)
      .set({ missingSince: nowIso() })
      .where(eq(schema.photos.id, "p2"));
    await db.update(schema.galleries).set({ coverPhotoId: "p2" });
    expect(await cover()).toBe("p1");
    await db.delete(schema.photos);
    expect(await cover()).toBeNull();
  });

  it("never leaks drive ids, pin hash, folder ids or R2 keys", async () => {
    const pinHash = await hashPin("1234");
    await addGallery({ pinHash });
    await addPhoto(1, {
      driveThumbId: "drive-thumb-SECRET",
      variantVersions: "{}",
    });
    await db.update(schema.galleries).set({ coverPhotoId: "p1" });
    const cookie = await cookieFor({ unlocked: true }, pinHash);
    const open = await loadGallery(
      get(URL_, { Cookie: cookie }),
      "boda-ana",
      env,
    );
    const locked = await loadGallery(get(), "boda-ana", env);
    for (const r of [open, locked]) {
      const s = JSON.stringify(r.data);
      expect(s).not.toMatch(
        /SECRET|pbkdf2|drive|pin_?hash|variant_?versions|baseName|IMG_/i,
      );
    }
  });
});

describe("view logging", () => {
  it("logs one view per session and sets a signed viewed flag", async () => {
    await addGallery();
    await addPhoto(1);
    const first = await loadGallery(
      get(URL_, {}, { country: "AR" }),
      "boda-ana",
      env,
    );
    expect(first.setCookie).toBeTruthy();
    let views = await db.select().from(schema.galleryViews);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ galleryId: G, country: "AR" });

    const cookie = first.setCookie!.split(";")[0];
    const session = await readGallerySession(
      get(URL_, { Cookie: cookie }),
      { id: G, pinHash: null },
      env,
    );
    expect(session?.viewed).toBe(true);

    const second = await loadGallery(
      get(URL_, { Cookie: cookie }),
      "boda-ana",
      env,
    );
    expect(second.setCookie).toBeUndefined();
    views = await db.select().from(schema.galleryViews);
    expect(views).toHaveLength(1);
  });

  it("a PIN session keeps unlocked when the viewed flag is added", async () => {
    const pinHash = await hashPin("1234");
    await addGallery({ pinHash });
    const r = await loadGallery(
      get(URL_, { Cookie: await cookieFor({ unlocked: true }, pinHash) }),
      "boda-ana",
      env,
    );
    const s = await readGallerySession(
      get(URL_, { Cookie: r.setCookie!.split(";")[0] }),
      { id: G, pinHash },
      env,
    );
    expect(s).toMatchObject({ unlocked: true, viewed: true });
  });

  it("no view and no cookie for unavailable or locked", async () => {
    await addGallery({ pinHash: await hashPin("1") });
    await loadGallery(get(), "boda-ana", env);
    await loadGallery(get(), "nope", env);
    expect(await db.select().from(schema.galleryViews)).toHaveLength(0);
  });

  it("cookie is Secure on https, not on http", async () => {
    await addGallery();
    const a = await loadGallery(
      get("https://x.test/boda-ana"),
      "boda-ana",
      env,
    );
    expect(a.setCookie).toMatch(/; Secure/);
    await env.DB.prepare("DELETE FROM gallery_views").run();
    const b = await loadGallery(
      get("http://localhost/boda-ana"),
      "boda-ana",
      env,
    );
    expect(b.setCookie).not.toMatch(/Secure/);
  });
});

describe("unlockGallery", () => {
  const post = (
    pin: string | null,
    headers: Record<string, string> = {},
    url = URL_ + "?lang=en",
  ) =>
    new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "CF-Connecting-IP": "203.0.113.7",
        "Sec-Fetch-Site": "same-origin",
        ...headers,
      },
      body: pin === null ? "" : new URLSearchParams({ pin }).toString(),
    });

  it("correct PIN: 303 to the same URL with an unlocked session cookie", async () => {
    const pinHash = await hashPin("1234");
    await addGallery({ pinHash });
    const r = await unlockGallery(post("1234"), "boda-ana", env);
    expect(r.status).toBe(303);
    if (r.status !== 303) return;
    expect(r.location).toBe("/boda-ana?lang=en");
    const s = await readGallerySession(
      get(URL_, { Cookie: r.setCookie.split(";")[0] }),
      { id: G, pinHash },
      env,
    );
    expect(s?.unlocked).toBe(true);
  });

  it("wrong or missing PIN: 400 and no cookie", async () => {
    await addGallery({ pinHash: await hashPin("1234") });
    for (const body of ["0000", "", null]) {
      const r = await unlockGallery(post(body), "boda-ana", env);
      expect(r.status).toBe(400);
      expect(r).not.toHaveProperty("setCookie");
    }
  });

  it("rate limits at 5 attempts per 10 min per ip+gallery, even for the right PIN", async () => {
    await addGallery({ pinHash: await hashPin("1234") });
    for (let i = 0; i < 5; i++) {
      expect((await unlockGallery(post("bad"), "boda-ana", env)).status).toBe(
        400,
      );
    }
    expect((await unlockGallery(post("1234"), "boda-ana", env)).status).toBe(
      429,
    );
    // another IP is unaffected
    const other = post("1234", { "CF-Connecting-IP": "198.51.100.9" });
    expect((await unlockGallery(other, "boda-ana", env)).status).toBe(303);
    // raw IP never stored
    const rows = await db.select().from(schema.rateLimits);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
  });

  it("the counter resets after the 10 minute window", async () => {
    await addGallery({ pinHash: await hashPin("1234") });
    for (let i = 0; i < 6; i++)
      await unlockGallery(post("bad"), "boda-ana", env);
    await db
      .update(schema.rateLimits)
      .set({ windowStart: nowIso(new Date(Date.now() - 11 * 60_000)) });
    expect((await unlockGallery(post("bad"), "boda-ana", env)).status).toBe(
      400,
    );
    const [row] = await db.select().from(schema.rateLimits);
    expect(row.count).toBe(1);
  });

  it("a successful unlock clears the per-visitor counter and keeps the gallery one at the wrong-guess count", async () => {
    await addGallery({ pinHash: await hashPin("1234") });
    await unlockGallery(post("bad"), "boda-ana", env);
    await unlockGallery(post("1234"), "boda-ana", env);
    const rows = await db.select().from(schema.rateLimits);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key.startsWith("pinG:")).toBe(true);
    expect(rows[0]?.count).toBe(1);
  });

  it("rejects cross-site requests with 403 and does not count them", async () => {
    await addGallery({ pinHash: await hashPin("1234") });
    const a = await unlockGallery(
      post("1234", { "Sec-Fetch-Site": "cross-site" }),
      "boda-ana",
      env,
    );
    const b = await unlockGallery(
      post("1234", { Origin: "https://evil.test" }),
      "boda-ana",
      env,
    );
    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
    expect(await db.select().from(schema.rateLimits)).toHaveLength(0);
    const ok = await unlockGallery(
      post("1234", { Origin: "https://session.test" }),
      "boda-ana",
      env,
    );
    expect(ok.status).toBe(303);
  });

  it("unknown/draft slug: 404 and still does the PBKDF2 work", async () => {
    await addGallery({ pinHash: await hashPin("1234") });
    const time = async (slug: string) => {
      const t0 = performance.now();
      await unlockGallery(post("bad"), slug, env);
      return performance.now() - t0;
    };
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 3; i++) {
      known.push(await time("boda-ana"));
      unknown.push(await time("does-not-exist"));
    }
    expect(
      (await unlockGallery(post("bad"), "does-not-exist", env)).status,
    ).toBe(404);
    const med = (a: number[]) => a.sort((x, y) => x - y)[1];
    expect(med(unknown)).toBeGreaterThan(med(known) * 0.4);
  });
});

describe("review: session merge, payload flags, dotted slugs", () => {
  it("unlocking keeps viewed and visitorId from the previous session", async () => {
    const pinHash = await hashPin("1234");
    await addGallery({ pinHash });
    const pf = await pinFingerprint(pinHash, env);
    const prev = await gallerySessionCookie(
      { galleryId: G, unlocked: false, pf, viewed: true, visitorId: "vis-1" },
      env,
      { secure: false },
    );
    const r = await unlockGallery(
      new Request(URL_, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "CF-Connecting-IP": "203.0.113.7",
          "Sec-Fetch-Site": "same-origin",
          Cookie: prev.split(";")[0],
        },
        body: new URLSearchParams({ pin: "1234" }).toString(),
      }),
      "boda-ana",
      env,
    );
    expect(r.status).toBe(303);
    if (r.status !== 303 || !r.setCookie) throw new Error("no cookie");
    const s = await readGallerySession(
      get(URL_, { Cookie: r.setCookie.split(";")[0] }),
      { id: G, pinHash },
      env,
    );
    expect(s).toMatchObject({
      unlocked: true,
      viewed: true,
      visitorId: "vis-1",
    });
  });

  it("the open payload carries the download permission flags", async () => {
    await addGallery({ allowHighres: false, allowWeb: true, allowIg: false });
    await addPhoto(1);
    const r = await loadGallery(get(), "boda-ana", env);
    if (r.data.state !== "open") throw new Error("not open");
    expect(r.data.gallery).toMatchObject({
      allowHighres: false,
      allowWeb: true,
      allowIg: false,
    });
  });

  it("a slug containing a dot is unavailable without touching D1", async () => {
    const boom = new Proxy(
      {},
      {
        get() {
          throw new Error("D1 must not be used");
        },
      },
    );
    const guarded = {
      DB: boom,
      SESSION_SECRET: env.SESSION_SECRET,
    } as unknown as typeof env;
    for (const slug of ["favicon.ico", "robots.txt", "a.b"]) {
      const r = await loadGallery(get(), slug, guarded);
      expect(r.status).toBe(404);
      expect(r.data).toEqual({ state: "unavailable" });
    }
  });
});
