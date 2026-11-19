import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, nowIso, schema } from "../app/db";
import { clientIpHash } from "../app/lib/server/access";
import { gallerySessionCookie, pinFingerprint } from "../app/lib/server/auth";
import { DriveError } from "../app/lib/server/drive-types";
import type { DriveClient } from "../app/lib/server/drive-types";
import { mockImageUrl } from "../app/lib/server/drive-mock";
import { serveImage } from "../app/lib/server/images";

const db = getDb(env);
const GA = "aaaaaaaa-0000-0000-0000-00000000000a";
const GB = "bbbbbbbb-0000-0000-0000-00000000000b";
const P = "pppppppp-0000-0000-0000-000000000001";
const googleEnv = { ...env, DRIVE_MODE: "google" } as Env;
const mockEnv = { ...env, DRIVE_MODE: "mock" } as Env;

beforeAll(async () => {
  await migrateDb();
});

function makeCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
      passThroughOnException() {},
    } as unknown as ExecutionContext,
    flush: () => Promise.all(pending),
  };
}

const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
function fakeDrive(opts: { status?: number; noLength?: boolean } = {}) {
  const calls: string[] = [];
  const drive = {
    async streamFile(id: string) {
      calls.push(id);
      if (opts.status) throw new DriveError(opts.status, "x", "detail " + id);
      const headers: Record<string, string> = {};
      if (!opts.noLength) headers["Content-Length"] = String(JPEG.length);
      return new Response(JPEG.slice(), { status: 200, headers });
    },
  } as unknown as DriveClient;
  return { drive, calls };
}

async function gallery(id: string, over: Record<string, unknown> = {}) {
  await db.insert(schema.galleries).values({
    id,
    driveFolderId: "folder-" + id,
    slug: "s-" + id,
    title: "T",
    status: "published",
    ...over,
  });
}
const VERSIONS = JSON.stringify({
  highres: "2026-01-01T00:00:01Z",
  web: "2026-01-01T00:00:02Z",
  ig: null,
  thumb: "2026-01-01T00:00:03Z",
  wm: "2026-01-01T00:00:04Z",
});
async function photo(over: Record<string, unknown> = {}) {
  await db.insert(schema.photos).values({
    id: P,
    galleryId: GA,
    baseName: "p1",
    driveHighresId: "DRIVE-HI",
    driveWebId: "DRIVE-WEB",
    driveThumbId: "DRIVE-THUMB",
    driveWmId: "DRIVE-WM",
    variantVersions: VERSIONS,
    width: 3000,
    height: 2000,
    ...over,
  });
}

async function get(
  variant: string,
  o: {
    e?: Env;
    drive?: DriveClient;
    headers?: Record<string, string>;
    photoId?: string;
  } = {},
) {
  const { ctx, flush } = makeCtx();
  const res = await serveImage(
    new Request(`https://x.test/img/${o.photoId ?? P}/${variant}`, {
      headers: o.headers,
    }),
    { photoId: o.photoId ?? P, variant },
    o.e ?? googleEnv,
    ctx,
    { drive: o.drive ?? fakeDrive().drive },
  );
  await flush();
  return res;
}

async function cookie(
  galleryId: string,
  pinHash: string | null,
  pfHash = pinHash,
) {
  const sc = await gallerySessionCookie(
    { galleryId, unlocked: true, pf: await pinFingerprint(pfHash, env) },
    env,
    { secure: true },
  );
  return sc.split(";")[0];
}

beforeEach(async () => {
  await db.delete(schema.galleries);
  for (const o of (await env.CACHE.list()).objects)
    await env.CACHE.delete(o.key);
  await gallery(GA);
  await photo();
});

async function expectGeneric404(res: Response) {
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("Not found");
}

describe("visibility", () => {
  it("serves a published public gallery without cookie", async () => {
    const res = await get("thumb");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=600");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
  });
  it("view-sm (the og:image variant) works cookieless for a public gallery", async () => {
    const res = await get("view-sm");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
  });
  it.each(["draft", "archived"])("404 for %s gallery", async (status) => {
    await db.update(schema.galleries).set({ status: status as "draft" });
    await expectGeneric404(await get("thumb"));
  });
  it("404 when expired (expires_at <= now), ok when future", async () => {
    await db
      .update(schema.galleries)
      .set({ expiresAt: "2000-01-01T00:00:00Z" });
    await expectGeneric404(await get("thumb"));
    await db
      .update(schema.galleries)
      .set({ expiresAt: "2999-01-01T00:00:00Z" });
    expect((await get("thumb")).status).toBe(200);
  });
  it("404 when missing_since is set", async () => {
    await db
      .update(schema.photos)
      .set({ missingSince: "2026-01-01T00:00:00Z" });
    await expectGeneric404(await get("thumb"));
  });
  it("404 for unknown photo, same body as hidden", async () => {
    await expectGeneric404(await get("thumb", { photoId: "nope" }));
  });
  it.each(["huge", "highres", "", "THUMB", "thumb/x"])(
    "404 for invalid variant %j",
    async (v) => {
      await expectGeneric404(await get(v));
    },
  );
});

describe("PIN", () => {
  const PIN = "pbkdf2$hash-a";
  beforeEach(async () => {
    await db.update(schema.galleries).set({ pinHash: PIN });
  });
  it("404 without cookie", async () => {
    await expectGeneric404(await get("thumb"));
  });
  it("404 with stale/wrong pf", async () => {
    const c = await cookie(GA, PIN, "other-hash");
    await expectGeneric404(await get("thumb", { headers: { Cookie: c } }));
  });
  it("404 with locked (unlocked:false) session", async () => {
    const sc = await gallerySessionCookie(
      { galleryId: GA, unlocked: false, pf: await pinFingerprint(PIN, env) },
      env,
      { secure: true },
    );
    await expectGeneric404(
      await get("thumb", { headers: { Cookie: sc.split(";")[0] } }),
    );
  });
  it("200 with valid cookie", async () => {
    const c = await cookie(GA, PIN);
    expect((await get("thumb", { headers: { Cookie: c } })).status).toBe(200);
  });
  it("404 with the cookie of another gallery", async () => {
    await gallery(GB, { pinHash: PIN });
    const c = await cookie(GB, PIN);
    await expectGeneric404(await get("thumb", { headers: { Cookie: c } }));
  });
});

describe("fallbacks and watermark", () => {
  async function fileFor(variant: string) {
    for (const o of (await env.CACHE.list()).objects)
      await env.CACHE.delete(o.key);
    const f = fakeDrive();
    const res = await get(variant, { drive: f.drive });
    return { res, calls: f.calls };
  }
  it("thumb: thumb ?? web ?? highres", async () => {
    expect((await fileFor("thumb")).calls).toEqual(["DRIVE-THUMB"]);
    await db.update(schema.photos).set({ driveThumbId: null });
    for (const o of (await env.CACHE.list()).objects)
      await env.CACHE.delete(o.key);
    expect((await fileFor("thumb")).calls).toEqual(["DRIVE-WEB"]);
    await db.update(schema.photos).set({ driveWebId: null });
    expect((await fileFor("thumb")).calls).toEqual(["DRIVE-HI"]);
  });
  it("view-sm: web ?? highres; view-lg: highres", async () => {
    expect((await fileFor("view-sm")).calls).toEqual(["DRIVE-WEB"]);
    expect((await fileFor("view-lg")).calls).toEqual(["DRIVE-HI"]);
    await db.update(schema.photos).set({ driveWebId: null });
    for (const o of (await env.CACHE.list()).objects)
      await env.CACHE.delete(o.key);
    expect((await fileFor("view-sm")).calls).toEqual(["DRIVE-HI"]);
  });
  it("proofing: view-* use wm and so does thumb (never the clean thumb)", async () => {
    await db.update(schema.galleries).set({ mode: "proofing" });
    expect((await fileFor("view-sm")).calls).toEqual(["DRIVE-WM"]);
    expect((await fileFor("view-lg")).calls).toEqual(["DRIVE-WM"]);
    expect((await fileFor("thumb")).calls).toEqual(["DRIVE-WM"]);
  });
  it("watermark on but no wm file: 404, no clean leak", async () => {
    await db.update(schema.galleries).set({ mode: "proofing" });
    await db.update(schema.photos).set({ driveWmId: null });
    const f = fakeDrive();
    await expectGeneric404(await get("view-lg", { drive: f.drive }));
    await expectGeneric404(await get("view-sm", { drive: f.drive }));
    expect(f.calls).toEqual([]);
  });
  it("wm present but watermark off: clean file", async () => {
    expect((await fileFor("view-lg")).calls).toEqual(["DRIVE-HI"]);
  });
});

describe("mock mode", () => {
  it.each([
    ["thumb", "thumb"],
    ["view-sm", "web"],
    ["view-lg", "highres"],
  ] as const)("302 for %s", async (variant, kind) => {
    const f = fakeDrive();
    const res = await get(variant, { e: mockEnv, drive: f.drive });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(mockImageUrl(P, kind, 3000, 2000));
    expect(res.headers.get("Location")).toContain(`/seed/${P}/`);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(f.calls).toEqual([]);
    expect([...res.headers.values()].join("|")).not.toContain("DRIVE-");
    expect((await env.CACHE.list()).objects).toHaveLength(0);
  });
  it("uses wm variant when watermark is on", async () => {
    await db.update(schema.galleries).set({ mode: "proofing" });
    const res = await get("view-lg", { e: mockEnv });
    expect(res.headers.get("Location")).toBe(mockImageUrl(P, "wm", 3000, 2000));
  });
  it("still enforces visibility", async () => {
    await db.update(schema.galleries).set({ status: "draft" });
    expect((await get("thumb", { e: mockEnv })).status).toBe(404);
  });
  it("watermark on without wm: 404", async () => {
    await db.update(schema.galleries).set({ mode: "proofing" });
    await db.update(schema.photos).set({ driveWmId: null });
    expect((await get("view-lg", { e: mockEnv })).status).toBe(404);
  });
});

describe("R2 read-through", () => {
  it("miss populates R2, response has no ids", async () => {
    const f = fakeDrive();
    const res = await get("view-lg", { drive: f.drive });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe(String(JPEG.length));
    expect([...res.headers.entries()].join("|")).not.toMatch(/DRIVE-|view-lg/);
    const obj = await env.CACHE.get(`${P}/view-lg`);
    expect(obj).not.toBeNull();
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(JPEG);
    expect(obj!.httpMetadata?.contentType).toBe("image/jpeg");
  });
  it("hit serves from R2 without Drive, with ETag", async () => {
    await env.CACHE.put(`${P}/thumb`, JPEG, {
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: {
        fileId: "DRIVE-THUMB",
        wm: "0",
        v: "2026-01-01T00:00:03Z",
      },
    });
    const f = fakeDrive();
    const res = await get("thumb", { drive: f.drive });
    expect(f.calls).toEqual([]);
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBeTruthy();
    expect(res.headers.get("Content-Length")).toBe(String(JPEG.length));
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=600");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
  });
  it("304 on matching If-None-Match, 200 on other", async () => {
    await env.CACHE.put(`${P}/thumb`, JPEG, {
      customMetadata: {
        fileId: "DRIVE-THUMB",
        wm: "0",
        v: "2026-01-01T00:00:03Z",
      },
    });
    const etag = (await get("thumb")).headers.get("ETag")!;
    const r304 = await get("thumb", { headers: { "If-None-Match": etag } });
    expect(r304.status).toBe(304);
    expect(r304.headers.get("ETag")).toBe(etag);
    expect(
      (await get("thumb", { headers: { "If-None-Match": '"zzz"' } })).status,
    ).toBe(200);
  });
  it("hit is still gated by visibility and PIN", async () => {
    await env.CACHE.put(`${P}/thumb`, JPEG);
    await db.update(schema.galleries).set({ pinHash: "h" });
    await expectGeneric404(await get("thumb"));
  });
  it("no Content-Length from Drive: streams but skips caching", async () => {
    const res = await get("thumb", {
      drive: fakeDrive({ noLength: true }).drive,
    });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect(await env.CACHE.get(`${P}/thumb`)).toBeNull();
  });
});

describe("Drive errors", () => {
  it("Drive 404 -> generic 404", async () => {
    await expectGeneric404(
      await get("thumb", { drive: fakeDrive({ status: 404 }).drive }),
    );
  });
  it.each([500, 403, 429, 401])("Drive %i -> generic 502", async (status) => {
    const res = await get("thumb", { drive: fakeDrive({ status }).drive });
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).not.toContain("DRIVE-");
    expect(body).not.toContain("detail");
  });
  it("non-Drive throw -> 502", async () => {
    const drive = {
      streamFile: async () => {
        throw new Error("boom");
      },
    } as unknown as DriveClient;
    expect((await get("thumb", { drive })).status).toBe(502);
  });
});

describe("metadata-validated cache", () => {
  it("after sync changes drive_*_id (re-export) the new file is served and the old cache overwritten", async () => {
    const a = fakeDrive();
    await get("view-lg", { drive: a.drive });
    await db.update(schema.photos).set({ driveHighresId: "DRIVE-HI-2" });
    const b = fakeDrive();
    const res = await get("view-lg", { drive: b.drive });
    expect(res.status).toBe(200);
    expect(b.calls).toEqual(["DRIVE-HI-2"]);
    const obj = await env.CACHE.get(`${P}/view-lg`);
    expect(obj?.customMetadata).toEqual({
      fileId: "DRIVE-HI-2",
      wm: "0",
      v: "2026-01-01T00:00:01Z",
    });
    const c = fakeDrive();
    await get("view-lg", { drive: c.drive });
    expect(c.calls).toEqual([]);
  });
  it("same file id but new modifiedTime -> miss and overwrite", async () => {
    await get("thumb", { drive: fakeDrive().drive });
    await db.update(schema.photos).set({
      variantVersions: VERSIONS.replace("00:03Z", "09:09Z").replace(
        "01T00:00:03",
        "01T00:09:09",
      ),
    });
    const b = fakeDrive();
    await get("thumb", { drive: b.drive });
    expect(b.calls).toEqual(["DRIVE-THUMB"]);
    expect((await env.CACHE.get(`${P}/thumb`))?.customMetadata?.v).toBe(
      "2026-01-01T00:09:09Z",
    );
  });
  it("unknown version (null variant_versions) is never served from cache", async () => {
    await db.update(schema.photos).set({ variantVersions: null });
    await env.CACHE.put(`${P}/thumb`, JPEG, {
      customMetadata: { fileId: "DRIVE-THUMB", wm: "0", v: "" },
    });
    const f = fakeDrive();
    await get("thumb", { drive: f.drive });
    expect(f.calls).toEqual(["DRIVE-THUMB"]);
  });
  it("blank Content-Length is treated as absent (streams uncached)", async () => {
    const drive = {
      streamFile: async () =>
        new Response(JPEG, { headers: { "Content-Length": " " } }),
    } as unknown as DriveClient;
    const res = await get("thumb", { drive });
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    expect(await env.CACHE.get(`${P}/thumb`)).toBeNull();
  });
  it("never echoes customMetadata or drive ids in response headers", async () => {
    await get("view-sm");
    const res = await get("view-sm");
    expect([...res.headers.entries()].join("\n")).not.toContain("DRIVE-");
  });
  it("passes through allowlisted content type, else image/jpeg", async () => {
    const mk = (ct: string) =>
      ({
        async streamFile() {
          return new Response(JPEG.slice(), {
            headers: {
              "Content-Length": String(JPEG.length),
              "Content-Type": ct,
            },
          });
        },
      }) as unknown as DriveClient;
    expect(
      (await get("thumb", { drive: mk("image/webp") })).headers.get(
        "Content-Type",
      ),
    ).toBe("image/webp");
    await env.CACHE.delete(`${P}/thumb`);
    expect(
      (await get("thumb", { drive: mk("text/html") })).headers.get(
        "Content-Type",
      ),
    ).toBe("image/jpeg");
  });
  it("empty upstream (Content-Length 0) -> 502", async () => {
    const drive = {
      streamFile: async () =>
        new Response(new Uint8Array(0), { headers: { "Content-Length": "0" } }),
    } as unknown as DriveClient;
    expect((await get("thumb", { drive })).status).toBe(502);
  });
});

describe("R2-miss rate limit (img:<ip>:<gallery>, 5000 / 10 min)", () => {
  const hdr = { "CF-Connecting-IP": "203.0.113.7" };
  const seed = async (n: number) => {
    const ipHash = await clientIpHash(
      new Request("https://x.test/", { headers: hdr }),
      env,
    );
    await env.DB.prepare(
      "INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?1, ?2, ?3)",
    )
      .bind(`img:${ipHash}:${GA}`, n, nowIso())
      .run();
  };
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM rate_limits").run();
  });

  it("429 + Retry-After once the budget is spent, Drive not called", async () => {
    await seed(5000);
    const f = fakeDrive();
    const res = await get("thumb", { drive: f.drive, headers: hdr });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(f.calls).toEqual([]);
  });
  it("still allowed at the limit", async () => {
    await seed(1499);
    const f = fakeDrive();
    expect((await get("thumb", { drive: f.drive, headers: hdr })).status).toBe(
      200,
    );
  });
  it("R2 hits are not counted or limited", async () => {
    const f = fakeDrive();
    await get("thumb", { drive: f.drive, headers: hdr });
    await seed(5000);
    const res = await get("thumb", { drive: f.drive, headers: hdr });
    expect(res.status).toBe(200);
    expect(f.calls.length).toBe(1);
  });
  it("another IP is unaffected", async () => {
    await seed(5000);
    const res = await get("thumb", {
      headers: { "CF-Connecting-IP": "203.0.113.8" },
    });
    expect(res.status).toBe(200);
  });
});
