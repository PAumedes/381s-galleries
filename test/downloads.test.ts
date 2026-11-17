import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { clientIpHash } from "../app/lib/server/access";
import { pinFingerprint } from "../app/lib/server/auth";
import { hashPin, signToken } from "../app/lib/server/crypto";
import { mockImageUrl } from "../app/lib/server/drive-mock";
import { DriveError } from "../app/lib/server/drive-types";
import type { DriveClient, StreamOptions } from "../app/lib/server/drive-types";
import {
  handleBulk,
  handleDownloadTokens,
  serveDownload,
} from "../app/lib/server/downloads";
import { handleVisitor } from "../app/lib/server/favorites";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000d1";
const G2 = "gggggggg-0000-0000-0000-0000000000d2";
const BASE = "https://session.test";
const IP = { "CF-Connecting-IP": "9.9.9.9" };
const googleEnv = { ...env, DRIVE_MODE: "google" } as Env;
const mockEnv = { ...env, DRIVE_MODE: "mock" } as Env;

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM downloads"),
    env.DB.prepare("DELETE FROM favorites"),
    env.DB.prepare("DELETE FROM visitors"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM photos"),
    env.DB.prepare("DELETE FROM galleries"),
  ]);
});

async function addGallery(
  over: Partial<typeof schema.galleries.$inferInsert> = {},
  id = G,
  slug = "boda",
) {
  await db.insert(schema.galleries).values({
    id,
    driveFolderId: "f-" + id,
    slug,
    title: "Boda",
    status: "published",
    requireEmail: false,
    ...over,
  });
}
async function addPhoto(
  id: string,
  over: Partial<typeof schema.photos.$inferInsert> = {},
  galleryId = G,
) {
  await db.insert(schema.photos).values({
    id,
    galleryId,
    baseName: `IMG_${id}`,
    driveHighresId: `hr-${id}`,
    driveWebId: `web-${id}`,
    driveIgId: `ig-${id}`,
    highresBytes: 1000,
    width: 3000,
    height: 2000,
    sort: 1,
    ...over,
  });
}

const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...IP, ...headers },
    body: JSON.stringify(body),
  });
type TokenBody = {
  tokens: { photoId: string; url: string; filename: string }[];
  missing: string[];
  unavailable: string[];
  error?: string;
};
const tokens = (
  body: unknown,
  headers: Record<string, string> = {},
  slug = "boda",
) =>
  handleDownloadTokens(
    post(`/api/g/${slug}/download-tokens`, body, headers),
    slug,
    env,
  );
const bulk = (body: unknown, headers: Record<string, string> = {}) =>
  handleBulk(post("/api/g/boda/bulk", body, headers), "boda", env);
const tokenOf = (url: string) => url.replace("/dl/", "");
const cookieOf = (res: Response) =>
  res.headers.getSetCookie()[0]?.split(";")[0] ?? "";

async function issue(
  photoId = "p1",
  variant = "highres",
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const res = await tokens({ photoIds: [photoId], variant, ...extra }, headers);
  expect(res.status).toBe(200);
  const body = (await res.json()) as TokenBody;
  return tokenOf(body.tokens[0].url);
}

const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
function fakeDrive(opts: { status?: number } = {}) {
  const calls: { id: string; range?: string }[] = [];
  const drive = {
    async streamFile(id: string, o?: StreamOptions) {
      calls.push({ id, range: o?.range });
      if (opts.status) throw new DriveError(opts.status, "x", "detail " + id);
      if (o?.range) {
        return new Response(JPEG.slice(2, 5), {
          status: 206,
          headers: {
            "Content-Length": "3",
            "Content-Range": `bytes 2-4/${JPEG.length}`,
            "Content-Type": "image/jpeg",
          },
        });
      }
      return new Response(JPEG.slice(), {
        status: 200,
        headers: {
          "Content-Length": String(JPEG.length),
          "Content-Type": "image/jpeg",
        },
      });
    },
  } as unknown as DriveClient;
  return { drive, calls };
}
const dl = (
  token: string,
  d: DriveClient,
  init: RequestInit = {},
  e: Env = googleEnv,
) =>
  serveDownload(new Request(`${BASE}/dl/${token}`, init), token, e, {
    drive: d,
  });
const downloadRows = () => db.select().from(schema.downloads);

describe("POST download-tokens: gates", () => {
  it("404 for unknown, draft, expired and locked galleries (same body)", async () => {
    await addGallery({ status: "draft" });
    await addPhoto("p1");
    const draft = await tokens({ photoIds: ["p1"], variant: "highres" });
    const unknown = await tokens(
      { photoIds: ["p1"], variant: "highres" },
      {},
      "nope",
    );
    expect(draft.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await draft.text()).toBe(await unknown.text());

    await db
      .update(schema.galleries)
      .set({ status: "published", pinHash: await hashPin("1234") });
    const locked = await tokens({ photoIds: ["p1"], variant: "highres" });
    expect(locked.status).toBe(404);
    await db
      .update(schema.galleries)
      .set({ pinHash: null, expiresAt: "2020-01-01T00:00:00Z" });
    expect(
      (await tokens({ photoIds: ["p1"], variant: "highres" })).status,
    ).toBe(404);
  });

  it("403 on cross-site POST", async () => {
    await addGallery();
    await addPhoto("p1");
    const res = await tokens(
      { photoIds: ["p1"], variant: "highres" },
      { "Sec-Fetch-Site": "cross-site" },
    );
    expect(res.status).toBe(403);
  });

  it("issues tokens for an anonymous visitor when require_email=0 and sets a cookie", async () => {
    await addGallery();
    await addPhoto("p1");
    const res = await tokens({ photoIds: ["p1"], variant: "highres" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(cookieOf(res)).toMatch(/^g_/);
    const vs = await db.select().from(schema.visitors);
    expect(vs).toHaveLength(1);
    expect(vs[0].email.endsWith("@anon.invalid")).toBe(true);
  });

  it("403 email_required when require_email, and also for an anon visitor after require_email is turned on", async () => {
    await addGallery();
    await addPhoto("p1");
    const first = await tokens({ photoIds: ["p1"], variant: "highres" });
    const anonCookie = cookieOf(first);
    await db.update(schema.galleries).set({ requireEmail: true });
    const noCookie = await tokens({ photoIds: ["p1"], variant: "highres" });
    expect(noCookie.status).toBe(403);
    expect(await noCookie.json()).toEqual({ error: "email_required" });
    const anon = await tokens(
      { photoIds: ["p1"], variant: "highres" },
      { Cookie: anonCookie },
    );
    expect(anon.status).toBe(403);
    expect(((await anon.json()) as { error: string }).error).toBe(
      "email_required",
    );

    const reg = await handleVisitor(
      post("/api/g/boda/visitor", { email: "a@b.com" }),
      "boda",
      env,
    );
    const ok = await tokens(
      { photoIds: ["p1"], variant: "highres" },
      { Cookie: cookieOf(reg) },
    );
    expect(ok.status).toBe(200);
  });

  it("403 variant_disabled per flag", async () => {
    await addGallery({ allowHighres: false, allowWeb: false, allowIg: false });
    await addPhoto("p1");
    for (const variant of ["highres", "web", "ig"]) {
      const res = await tokens({ photoIds: ["p1"], variant });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "variant_disabled" });
    }
  });

  it("403 when allow_bulk is off and more than one id or a bulkId is sent", async () => {
    await addGallery({ allowBulk: false });
    await addPhoto("p1");
    await addPhoto("p2");
    const multi = await tokens({ photoIds: ["p1", "p2"], variant: "highres" });
    expect(multi.status).toBe(403);
    const withBulk = await tokens({
      photoIds: ["p1"],
      variant: "highres",
      bulkId: "x",
    });
    expect(withBulk.status).toBe(403);
    expect(
      (await tokens({ photoIds: ["p1"], variant: "highres" })).status,
    ).toBe(200);
    expect((await bulk({ scope: "all", variant: "highres" })).status).toBe(403);
  });

  it("400 for bad bodies: empty, >50, duplicates, bad variant, non-strings", async () => {
    await addGallery();
    await addPhoto("p1");
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `x${i}`);
    for (const body of [
      { photoIds: [], variant: "highres" },
      { photoIds: ids(51), variant: "highres" },
      { photoIds: ["p1", "p1"], variant: "highres" },
      { photoIds: ["p1"], variant: "raw" },
      { photoIds: [1], variant: "highres" },
      { photoIds: "p1", variant: "highres" },
      { variant: "highres" },
      { photoIds: ["p1"], variant: "highres", bulkId: "nope-not-a-bulk" },
    ]) {
      expect((await tokens(body)).status).toBe(400);
    }
    expect(
      (await tokens({ photoIds: ids(50), variant: "highres" })).status,
    ).toBe(200);
  });

  it("429 after 300 token requests per 10 min (ip+gallery), with Retry-After", async () => {
    await addGallery();
    await addPhoto("p1");
    const key = `dl:${await clientIpHash(post("/", {}), env)}:${G}`;
    const seed = (n: number) =>
      env.DB.prepare(
        "INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?1, ?2, ?3)",
      )
        .bind(
          key,
          n,
          new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
        )
        .run();
    await seed(299);
    expect(
      (await tokens({ photoIds: ["p1"], variant: "highres" })).status,
    ).toBe(200);
    const res = await tokens({ photoIds: ["p1"], variant: "highres" });
    expect(res.status).toBe(429);
    const ra = Number(res.headers.get("Retry-After"));
    expect(Number.isInteger(ra)).toBe(true);
    // window is 10 min and 60 s have elapsed
    expect(ra).toBeGreaterThan(500);
    expect(ra).toBeLessThanOrEqual(540);
  });

  it("allows well over the old 120 requests (large galleries refresh tokens)", async () => {
    await addGallery();
    await addPhoto("p1");
    const key = `dl:${await clientIpHash(post("/", {}), env)}:${G}`;
    await env.DB.prepare(
      "INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 150, ?2)",
    )
      .bind(key, new Date().toISOString().replace(/\.\d{3}Z$/, "Z"))
      .run();
    expect(
      (await tokens({ photoIds: ["p1"], variant: "highres" })).status,
    ).toBe(200);
  });
});

describe("POST download-tokens: photos", () => {
  it("returns tokens with filenames (no per-token bytes); cross-gallery and invisible ids go to missing", async () => {
    await addGallery();
    await addGallery({}, G2, "otra");
    await addPhoto("p1", { baseName: "A001" });
    await addPhoto("p2", {
      baseName: "A002",
      missingSince: "2026-01-01T00:00:00Z",
    });
    await addPhoto("q1", {}, G2);
    const res = await tokens({
      photoIds: ["p1", "p2", "q1", "ghost"],
      variant: "highres",
    });
    const body = (await res.json()) as TokenBody;
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]).toMatchObject({
      photoId: "p1",
      filename: "A001.jpg",
    });
    expect(body.tokens[0]).not.toHaveProperty("bytes");
    expect(body.tokens[0].url).toMatch(/^\/dl\/[\w-]+\.[\w-]+$/);
    expect(body.missing.sort()).toEqual(["ghost", "p2", "q1"]);
    expect(body.unavailable).toEqual([]);
  });

  it("filenames per variant; missing variant -> unavailable (no fallback)", async () => {
    await addGallery();
    await addPhoto("p1", { baseName: "A001" });
    await addPhoto("p2", {
      baseName: "A002",
      driveWebId: null,
      driveIgId: null,
    });
    const web = (await (
      await tokens({ photoIds: ["p1", "p2"], variant: "web" })
    ).json()) as TokenBody;
    expect(web.tokens).toHaveLength(1);
    expect(web.tokens[0].filename).toBe("A001-web.jpg");
    expect(web.unavailable).toEqual(["p2"]);
    const ig = (await (
      await tokens({ photoIds: ["p1", "p2"], variant: "ig" })
    ).json()) as TokenBody;
    expect(ig.tokens[0].filename).toBe("A001-ig.jpg");
    expect(ig.unavailable).toEqual(["p2"]);
  });

  it("sanitizes filenames: strips separators and control chars, keeps unicode", async () => {
    await addGallery();
    await addPhoto("p1", { baseName: "a/b\\c\u0000d\u0007 Año" });
    const body = (await (
      await tokens({ photoIds: ["p1"], variant: "highres" })
    ).json()) as TokenBody;
    expect(body.tokens[0].filename).toBe("abcd Año.jpg");
  });

  it("never leaks drive ids", async () => {
    await addGallery();
    await addPhoto("p1");
    const text = await (
      await tokens({ photoIds: ["p1"], variant: "highres" })
    ).text();
    expect(text).not.toContain("hr-p1");
  });
});

describe("POST bulk", () => {
  it("scope all: one bulk row, visible photos ordered as the gallery, only with the variant", async () => {
    await addGallery();
    await addPhoto("b", { setName: "Fiesta", sort: 1, baseName: "B" });
    await addPhoto("a", { setName: "Ceremonia", sort: 2, baseName: "A2" });
    await addPhoto("c", { setName: "Ceremonia", sort: 1, baseName: "A1" });
    await addPhoto("h", { missingSince: "2026-01-01T00:00:00Z" });
    await addPhoto("nw", { setName: "Zeta", driveWebId: null });
    const res = await bulk({ scope: "all", variant: "web" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bulkId: string;
      photoIds: string[];
      totalBytes?: number;
    };
    expect(body.photoIds).toEqual(["c", "a", "b"]);
    expect(body.totalBytes).toBeUndefined();
    expect(body.bulkId).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await downloadRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: body.bulkId,
      kind: "bulk",
      photoId: null,
      variant: "web",
      galleryId: G,
      bulkScope: "all",
    });
    const hi = (await (
      await bulk({ scope: "all", variant: "highres" })
    ).json()) as { totalBytes: number; photoIds: string[] };
    expect(hi.totalBytes).toBe(1000 * hi.photoIds.length);
  });

  it("scope set and favorites; validation", async () => {
    await addGallery();
    await addPhoto("a", { setName: "Ceremonia" });
    await addPhoto("b", { setName: "Fiesta", baseName: "B" });
    await addPhoto("c", { setName: "Fiesta", baseName: "C", sort: 2 });
    const setRes = await bulk({
      scope: "set",
      set: "Fiesta",
      variant: "highres",
    });
    const cookie = cookieOf(setRes);
    const set = (await setRes.json()) as { photoIds: string[] };
    expect(set.photoIds).toEqual(["b", "c"]);
    expect((await bulk({ scope: "set", variant: "highres" })).status).toBe(400);
    expect((await bulk({ scope: "zzz", variant: "highres" })).status).toBe(400);
    expect((await bulk({ scope: "all", variant: "nope" })).status).toBe(400);

    // favorites: need a visitor
    const fav0 = await bulk(
      { scope: "favorites", variant: "highres" },
      { Cookie: cookie },
    );
    expect(((await fav0.json()) as { photoIds: string[] }).photoIds).toEqual(
      [],
    );
    const v = (await db.select().from(schema.visitors))[0];
    await db.insert(schema.favorites).values([
      { galleryId: G, visitorId: v.id, photoId: "c", listName: "Favoritos" },
      { galleryId: G, visitorId: v.id, photoId: "a", listName: "Favoritos" },
    ]);
    const fav = (await (
      await bulk({ scope: "favorites", variant: "highres" }, { Cookie: cookie })
    ).json()) as { photoIds: string[] };
    expect(fav.photoIds).toEqual(["a", "c"]);
  });

  it("gates: variant disabled 403, email required 403, cross-site 403, locked 404, rate limit shared with dl:", async () => {
    await addGallery({ allowIg: false });
    await addPhoto("p1");
    expect((await bulk({ scope: "all", variant: "ig" })).status).toBe(403);
    expect(
      (
        await bulk(
          { scope: "all", variant: "web" },
          { "Sec-Fetch-Site": "cross-site" },
        )
      ).status,
    ).toBe(403);
    await db.update(schema.galleries).set({ requireEmail: true });
    expect(await (await bulk({ scope: "all", variant: "web" })).json()).toEqual(
      { error: "email_required" },
    );
    await db
      .update(schema.galleries)
      .set({ requireEmail: false, pinHash: await hashPin("1") });
    expect((await bulk({ scope: "all", variant: "web" })).status).toBe(404);
    expect(await downloadRows()).toHaveLength(0);
    await db.update(schema.galleries).set({ pinHash: null });
    await env.DB.prepare(
      "INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 300, ?2)",
    )
      .bind(
        `dl:${await clientIpHash(post("/", {}), env)}:${G}`,
        new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      )
      .run();
    const limited = await bulk({ scope: "all", variant: "web" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("a bulkId from /bulk is accepted by download-tokens and logged as bulk", async () => {
    await addGallery();
    await addPhoto("p1");
    await addPhoto("p2", { baseName: "B" });
    const br = await bulk({ scope: "all", variant: "highres" });
    const b = (await br.clone().json()) as { bulkId: string };
    const t = await issue(
      "p1",
      "highres",
      { bulkId: b.bulkId },
      {
        Cookie: cookieOf(br),
      },
    );
    const { drive } = fakeDrive();
    expect((await dl(t, drive)).status).toBe(200);
    const rows = (await downloadRows()).filter((r) => r.photoId === "p1");
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("bulk");
    expect(rows[0].bulkId).toBe(b.bulkId);
  });

  it("bulk header stores the set scope; single downloads have no bulk link", async () => {
    await addGallery();
    await addPhoto("p1", { setName: "Fiesta" });
    const b = (await (
      await bulk({ scope: "set", set: "Fiesta", variant: "highres" })
    ).json()) as { bulkId: string };
    const h = (await downloadRows()).find((r) => r.id === b.bulkId);
    expect(h?.bulkScope).toBe("set:Fiesta");
    const t = await issue("p1", "highres");
    const { drive } = fakeDrive();
    await dl(t, drive);
    const single = (await downloadRows()).find((r) => r.photoId === "p1");
    expect(single).toMatchObject({ kind: "single", bulkId: null });
  });
});

describe("GET /dl/:token", () => {
  it("streams the high-res file from Drive without buffering, with download headers", async () => {
    await addGallery();
    await addPhoto("p1", { baseName: "A001" });
    const t = await issue();
    let pulls = 0;
    const calls: string[] = [];
    const drive = {
      async streamFile(id: string) {
        calls.push(id);
        const body = new ReadableStream<Uint8Array>(
          {
            pull(c) {
              pulls++;
              if (pulls === 1) c.enqueue(JPEG.slice(0, 4));
              else if (pulls === 2) c.enqueue(JPEG.slice(4));
              else c.close();
            },
          },
          { highWaterMark: 0 },
        );
        return new Response(body, {
          headers: {
            "Content-Length": String(JPEG.length),
            "Content-Type": "image/jpeg",
          },
        });
      },
    } as unknown as DriveClient;
    const res = await dl(t, drive);
    expect(res.status).toBe(200);
    expect(pulls).toBe(0); // nothing read yet: streamed, not buffered
    expect(calls).toEqual(["hr-p1"]);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Length")).toBe(String(JPEG.length));
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="A001.jpg"; filename*=UTF-8''A001.jpg`,
    );
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect(pulls).toBeGreaterThanOrEqual(2);
  });

  it("serves web and ig files for those variants", async () => {
    await addGallery();
    await addPhoto("p1", { baseName: "A001" });
    const { drive, calls } = fakeDrive();
    const w = await dl(await issue("p1", "web"), drive);
    expect(w.headers.get("Content-Disposition")).toContain(
      'filename="A001-web.jpg"',
    );
    await dl(await issue("p1", "ig"), drive);
    expect(calls.map((c) => c.id)).toEqual(["web-p1", "ig-p1"]);
  });

  it("passes Range through and answers 206", async () => {
    await addGallery();
    await addPhoto("p1");
    const t = await issue();
    const { drive, calls } = fakeDrive();
    const res = await dl(t, drive, { headers: { Range: "bytes=2-4" } });
    expect(res.status).toBe(206);
    expect(calls[0].range).toBe("bytes=2-4");
    expect(res.headers.get("Content-Range")).toBe(`bytes 2-4/${JPEG.length}`);
    expect(res.headers.get("Content-Length")).toBe("3");
  });

  it("content-type is allowlisted", async () => {
    await addGallery();
    await addPhoto("p1");
    const drive = {
      async streamFile() {
        return new Response(JPEG.slice(), {
          headers: { "Content-Type": "text/html", "Content-Length": "9" },
        });
      },
    } as unknown as DriveClient;
    const res = await dl(await issue(), drive);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("410 for expired, tampered and garbage tokens (identical body)", async () => {
    await addGallery();
    await addPhoto("p1");
    const t = await issue();
    const { drive, calls } = fakeDrive();
    const expired = await signToken(
      {
        t: "dl",
        jti: "j1",
        g: G,
        p: "p1",
        v: "highres",
        vid: "x",
        pf: await pinFingerprint(null, env),
      },
      env.DOWNLOAD_SECRET,
      -5,
    );
    const [body, sig] = t.split(".");
    const tampered = `${body.slice(0, -2)}AA.${sig}`;
    const r1 = await dl(expired, drive);
    const r2 = await dl(tampered, drive);
    const r3 = await dl("garbage", drive);
    const r4 = await dl(`${body}.${sig.slice(0, -4)}AAAA`, drive);
    for (const r of [r1, r2, r3, r4]) expect(r.status).toBe(410);
    const texts = await Promise.all([r1, r2, r3, r4].map((r) => r.text()));
    expect(new Set(texts).size).toBe(1);
    expect(calls).toHaveLength(0);
    expect(await downloadRows()).toHaveLength(0);
  });

  it("rejects tokens signed with another secret or another purpose", async () => {
    await addGallery();
    await addPhoto("p1");
    const { drive } = fakeDrive();
    const payload = {
      t: "dl",
      jti: "j",
      g: G,
      p: "p1",
      v: "highres",
      vid: "x",
      pf: await pinFingerprint(null, env),
    };
    const wrong = await signToken(payload, env.SESSION_SECRET, 600);
    expect((await dl(wrong, drive)).status).toBe(410);
    const purpose = await signToken(
      { ...payload, t: "x" },
      env.DOWNLOAD_SECRET,
      600,
    );
    expect((await dl(purpose, drive)).status).toBe(410);
  });

  it("a gallery A token cannot fetch gallery B's photo", async () => {
    await addGallery();
    await addGallery({}, G2, "otra");
    await addPhoto("q1", {}, G2);
    const { drive, calls } = fakeDrive();
    const forged = await signToken(
      {
        t: "dl",
        jti: "j2",
        g: G,
        p: "q1",
        v: "highres",
        vid: "x",
        pf: await pinFingerprint(null, env),
      },
      env.DOWNLOAD_SECRET,
      600,
    );
    expect((await dl(forged, drive)).status).toBe(410);
    expect(calls).toHaveLength(0);
  });

  it("410 after the PIN changes", async () => {
    await addGallery({ pinHash: await hashPin("1234") });
    await addPhoto("p1");
    const g = (await db.select().from(schema.galleries))[0];
    const { gallerySessionCookie } = await import("../app/lib/server/auth");
    const cookie = (
      await gallerySessionCookie(
        {
          galleryId: G,
          unlocked: true,
          pf: await pinFingerprint(g.pinHash, env),
        },
        env,
        { secure: false },
      )
    ).split(";")[0];
    const t = await issue("p1", "highres", {}, { Cookie: cookie });
    const { drive } = fakeDrive();
    expect((await dl(t, drive)).status).toBe(200);
    await db.update(schema.galleries).set({ pinHash: await hashPin("9999") });
    expect((await dl(t, drive)).status).toBe(410);
    await db.update(schema.galleries).set({ pinHash: null });
    expect((await dl(t, drive)).status).toBe(410);
  });

  it("410 when the gallery is unpublished/expired, the photo hidden or deleted, or the variant disabled/removed", async () => {
    await addGallery();
    await addPhoto("p1");
    const { drive, calls } = fakeDrive();
    const t = await issue();
    const tw = await issue("p1", "web");
    await db.update(schema.galleries).set({ status: "draft" });
    expect((await dl(t, drive)).status).toBe(410);
    await db
      .update(schema.galleries)
      .set({ status: "published", expiresAt: "2020-01-01T00:00:00Z" });
    expect((await dl(t, drive)).status).toBe(410);
    await db.update(schema.galleries).set({ expiresAt: null });
    expect((await dl(t, drive)).status).toBe(200);
    await db
      .update(schema.photos)
      .set({ missingSince: "2026-01-01T00:00:00Z" });
    expect((await dl(t, drive)).status).toBe(410);
    await db.update(schema.photos).set({ missingSince: null });
    await db.update(schema.galleries).set({ allowWeb: false });
    expect((await dl(tw, drive)).status).toBe(410);
    await db.update(schema.galleries).set({ allowWeb: true });
    await db.update(schema.photos).set({ driveWebId: null });
    expect((await dl(tw, drive)).status).toBe(410);
    await db.delete(schema.photos).where(eq(schema.photos.id, "p1"));
    expect((await dl(t, drive)).status).toBe(410);
    expect(calls).toHaveLength(1);
  });

  it("toggling allow_* revokes outstanding tokens; a bulk token stops when allow_bulk is off", async () => {
    await addGallery();
    await addPhoto("p1");
    const { drive } = fakeDrive();
    const bulkResp = await bulk({ scope: "all", variant: "highres" });
    const bulkRes = (await bulkResp.clone().json()) as { bulkId: string };
    const tb = await issue(
      "p1",
      "highres",
      { bulkId: bulkRes.bulkId },
      {
        Cookie: cookieOf(bulkResp),
      },
    );
    const single = await issue("p1", "highres");
    const th = await issue("p1", "ig");
    expect((await dl(tb, drive)).status).toBe(200);
    await db.update(schema.galleries).set({ allowBulk: false });
    expect((await dl(tb, drive)).status).toBe(410);
    // A single-photo token is not a bulk token: still fine.
    expect((await dl(single, drive)).status).toBe(200);
    await db.update(schema.galleries).set({ allowBulk: true });
    expect((await dl(tb, drive)).status).toBe(200);
    await db.update(schema.galleries).set({ allowIg: false });
    expect((await dl(th, drive)).status).toBe(410);
    await db
      .update(schema.galleries)
      .set({ allowIg: true, allowHighres: false });
    expect((await dl(single, drive)).status).toBe(410);
  });

  it("a delivery gallery that also has wm files serves the clean file, never the wm file", async () => {
    await addGallery({ mode: "delivery" });
    await addPhoto("p1", { driveWmId: "wm-p1" });
    const { drive, calls } = fakeDrive();
    for (const v of ["highres", "web", "ig"])
      await dl(await issue("p1", v), drive);
    expect(calls.map((c) => c.id)).toEqual(["hr-p1", "web-p1", "ig-p1"]);
    expect(calls.some((c) => c.id.startsWith("wm"))).toBe(false);
  });

  it("logs once per token across repeated hits; HEAD does not log", async () => {
    await addGallery();
    await addPhoto("p1");
    const t = await issue("p1", "web");
    const { drive } = fakeDrive();
    const ua = "x".repeat(300);
    for (let i = 0; i < 3; i++) {
      const r = await dl(t, drive, { headers: { "User-Agent": ua } });
      await r.arrayBuffer();
    }
    const rows = await downloadRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      galleryId: G,
      photoId: "p1",
      variant: "web",
      kind: "single",
    });
    expect(rows[0].visitorId).toBeTruthy();
    expect(rows[0].ua).toHaveLength(200);

    const t2 = await issue("p1", "ig");
    const head = await dl(t2, drive, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await downloadRows()).toHaveLength(1);
    await dl(t2, drive);
    expect(await downloadRows()).toHaveLength(2);
  });

  it("records the country from cf", async () => {
    await addGallery();
    await addPhoto("p1");
    const t = await issue();
    const { drive } = fakeDrive();
    const req = new Request(`${BASE}/dl/${t}`, {
      cf: { country: "AR" },
    } as RequestInit);
    await serveDownload(req, t, googleEnv, { drive });
    expect((await downloadRows())[0].country).toBe("AR");
  });

  it("Content-Disposition for unicode and quoted names", async () => {
    await addGallery();
    await addPhoto("p1", { baseName: 'Año "Nuevo"; x' });
    const { drive } = fakeDrive();
    const res = await dl(await issue(), drive);
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="A_o _Nuevo_; x.jpg"; filename*=UTF-8''A%C3%B1o%20%22Nuevo%22%3B%20x.jpg`,
    );
  });

  it("Drive 404 -> 410, other Drive errors -> 502 without leaking detail", async () => {
    await addGallery();
    await addPhoto("p1");
    const t = await issue();
    expect((await dl(t, fakeDrive({ status: 404 }).drive)).status).toBe(410);
    const bad = await dl(t, fakeDrive({ status: 500 }).drive);
    expect(bad.status).toBe(502);
    expect(await bad.text()).not.toContain("hr-p1");
  });

  it("mock mode: logs then 302 to the picsum URL seeded with photo.id", async () => {
    await addGallery();
    await addPhoto("p1", { width: 3000, height: 2000 });
    const t = await issue("p1", "web");
    const res = await dl(t, fakeDrive().drive, {}, mockEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      mockImageUrl("p1", "web", 3000, 2000),
    );
    expect(res.headers.get("Location")).not.toContain("web-p1");
    expect(await downloadRows()).toHaveLength(1);
  });
});

describe("GET /dl abuse limits", () => {
  const ipHeaders = { "CF-Connecting-IP": "9.9.9.9" };
  const seedKey = (key: string, n: number, ageMs = 0) =>
    env.DB.prepare(
      "INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?1, ?2, ?3)",
    )
      .bind(key, n, new Date(Date.now() - ageMs).toISOString())
      .run();

  it("429 with Retry-After after 3000 /dl hits per ip+gallery per 10 min", async () => {
    await addGallery();
    await addPhoto("p1");
    const t = await issue();
    const ip = await clientIpHash(
      new Request("https://x.test/", { headers: ipHeaders }),
      env,
    );
    await seedKey(`dlget:${ip}:${G}`, 3000, 60_000);
    const { drive } = fakeDrive();
    const res = await dl(t, drive, { headers: ipHeaders });
    expect(res.status).toBe(429);
    const ra = Number(res.headers.get("Retry-After"));
    expect(ra).toBeGreaterThan(0);
    expect(ra).toBeLessThanOrEqual(600);
    // another ip is unaffected
    expect(
      (await dl(t, drive, { headers: { "CF-Connecting-IP": "8.8.8.8" } }))
        .status,
    ).toBe(200);
  });

  it("a token works 20 times, the 21st is 429 with Retry-After <= its TTL", async () => {
    await addGallery();
    await addPhoto("p1");
    const t = await issue();
    const { drive } = fakeDrive();
    for (let i = 0; i < 20; i++)
      expect((await dl(t, drive, { headers: ipHeaders })).status).toBe(200);
    const res = await dl(t, drive, { headers: ipHeaders });
    expect(res.status).toBe(429);
    const ra = Number(res.headers.get("Retry-After"));
    expect(ra).toBeGreaterThan(0);
    expect(ra).toBeLessThanOrEqual(600);
    const rows = await env.DB.prepare(
      "SELECT key FROM rate_limits WHERE key LIKE 'dlj:%'",
    ).all();
    expect(rows.results).toHaveLength(1);
  });

  it("the token cap applies even without a client ip header", async () => {
    await addGallery();
    await addPhoto("p1");
    const t = await issue();
    const { drive } = fakeDrive();
    for (let i = 0; i < 20; i++) await dl(t, drive);
    expect((await dl(t, drive)).status).toBe(429);
  });
});
