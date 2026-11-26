import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { DriveError } from "../app/lib/server/drive-types";
import type { DriveClient, StreamOptions } from "../app/lib/server/drive-types";
import {
  handleBulk,
  handleDownloadTokens,
  serveDownload,
} from "../app/lib/server/downloads";
import { clearCache } from "./support/cache";

/** T6.53d: a TIFF original is streamed by `/dl/<token>`, never cached, never bulk, never in Prueba. */
const db = getDb(env);
const GID = "gggggggg-0000-0000-0000-0000000000e1";
const BASE = "https://tiff.test";
const IP = { "CF-Connecting-IP": "8.8.8.8" };
const googleEnv = { ...env, DRIVE_MODE: "google" } as Env;

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables(
    "downloads",
    "favorites",
    "visitors",
    "rate_limits",
    "photos",
    "galleries",
  );
  await clearCache();
});

async function gallery(
  over: Partial<typeof schema.galleries.$inferInsert> = {},
) {
  await db.insert(schema.galleries).values({
    id: GID,
    driveFolderId: "f",
    slug: "retoque",
    title: "Retoque",
    status: "published",
    requireEmail: false,
    ...over,
  });
}
/** `t1`: TIFF-only; `t2`: TIFF + web JPEG; `j1`: JPEG only; `m1`: JPEG high-res + TIFF. */
async function photos() {
  const row = (
    id: string,
    over: Partial<typeof schema.photos.$inferInsert>,
  ) => ({
    id,
    galleryId: GID,
    baseName: `IMG_${id}`,
    driveHighresId: `hr-${id}`,
    highresBytes: 1000,
    sort: 1,
    ...over,
  });
  await db.insert(schema.photos).values([
    row("t1", {
      driveHighresId: "TIF-t1",
      driveTiffId: "TIF-t1",
      highresBytes: 300_000_000,
    }),
    row("t2", {
      driveHighresId: "TIF-t2",
      driveTiffId: "TIF-t2",
      driveWebId: "web-t2",
    }),
    row("j1", { driveWebId: "web-j1" }),
    row("m1", { driveTiffId: "TIF-m1" }),
  ]);
}

const post = (path: string, body: unknown) =>
  new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...IP },
    body: JSON.stringify(body),
  });
const tokens = (body: unknown) =>
  handleDownloadTokens(
    post("/api/g/retoque/download-tokens", body),
    "retoque",
    env,
  );
type Tokens = {
  tokens: { photoId: string; url: string; filename: string }[];
  unavailable: string[];
};
async function issue(photoIds: string[], variant = "highres") {
  const res = await tokens({ photoIds, variant });
  expect(res.status).toBe(200);
  return (await res.json()) as Tokens;
}
const tokenOf = (url: string) => url.replace("/dl/", "");

type Reply = {
  status?: number;
  headers?: Record<string, string>;
  body?: BodyInit | null;
};
function driveFor(reply: Reply | DriveError | (() => Reply | DriveError)) {
  const calls: { id: string; range?: string }[] = [];
  const drive = {
    async streamFile(id: string, o?: StreamOptions) {
      calls.push({ id, range: o?.range });
      const r = typeof reply === "function" ? reply() : reply;
      if (r instanceof DriveError) throw r;
      return new Response(r.body ?? null, {
        status: r.status ?? 200,
        headers: r.headers,
      });
    },
  } as unknown as DriveClient;
  return { drive, calls };
}
const dl = (
  token: string,
  drive: DriveClient,
  init: RequestInit = {},
  e: Env = googleEnv,
) =>
  serveDownload(
    new Request(`${BASE}/dl/${token}`, { headers: IP, ...init }),
    token,
    e,
    { drive },
  );
const TIFF_HEAD = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 1, 2, 3, 4]);

describe("T6.53d /dl streams the TIFF original", () => {
  beforeEach(async () => {
    await gallery();
    await photos();
  });

  it("TIFF-only: the Drive TIFF is streamed with image/tiff, a sanitized .tif name and the upstream length", async () => {
    const t = await issue(["t1"]);
    expect(t.tokens[0].filename).toBe("IMG_t1.tif");
    const { drive, calls } = driveFor({
      // Drive often answers application/octet-stream for a TIFF.
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": "8",
      },
      body: TIFF_HEAD.slice(),
    });
    const res = await dl(tokenOf(t.tokens[0].url), drive);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/tiff");
    expect(res.headers.get("Content-Length")).toBe("8");
    expect(res.headers.get("Content-Disposition")).toContain(
      'attachment; filename="IMG_t1.tif"',
    );
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(TIFF_HEAD);
    expect(calls).toEqual([{ id: "TIF-t1", range: undefined }]);
  });

  it("a photo with a JPEG high-res AND a TIFF: the high-res download is the TIFF, the web size stays the JPEG", async () => {
    const hi = await issue(["m1"]);
    const web = await issue(["j1"], "web");
    const a = driveFor({ body: TIFF_HEAD.slice() });
    await dl(tokenOf(hi.tokens[0].url), a.drive);
    expect(a.calls[0].id).toBe("TIF-m1");
    expect(hi.tokens[0].filename).toBe("IMG_m1.tif");
    expect(web.tokens[0].filename).toBe("IMG_j1-web.jpg");
  });

  it("a JPEG photo is unchanged: image/jpeg and .jpg", async () => {
    const t = await issue(["j1"]);
    expect(t.tokens[0].filename).toBe("IMG_j1.jpg");
    const { drive } = driveFor({
      headers: { "Content-Type": "image/jpeg" },
      body: new Uint8Array([0xff, 0xd8]),
    });
    const res = await dl(tokenOf(t.tokens[0].url), drive);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("passes Range through and mirrors 206 / Content-Range / Accept-Ranges", async () => {
    const t = await issue(["t1"]);
    const { drive, calls } = driveFor({
      status: 206,
      headers: {
        "Content-Length": "3",
        "Content-Range": "bytes 2-4/300000000",
        "Accept-Ranges": "bytes",
        ETag: '"v1"',
        "Content-Type": "image/tiff",
      },
      body: TIFF_HEAD.slice(2, 5),
    });
    const res = await dl(tokenOf(t.tokens[0].url), drive, {
      headers: { ...IP, Range: "bytes=2-4" },
    });
    expect(calls[0].range).toBe("bytes=2-4");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 2-4/300000000");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it.each([
    ["bytes=0-1,5-6", undefined],
    ["bytes=0-1, 5-", undefined],
    ["items=0-5", undefined],
    ["bytes=", undefined],
    ["bytes=5-2x", undefined],
    ["bytes=10-", "bytes=10-"],
    ["bytes=-500", "bytes=-500"],
    ["bytes=0-99", "bytes=0-99"],
  ])(
    "Range %j reaches Drive as %j (a single range only)",
    async (asked, sent) => {
      const t = await issue(["t1"]);
      const { drive, calls } = driveFor({ body: TIFF_HEAD.slice() });
      const res = await dl(tokenOf(t.tokens[0].url), drive, {
        headers: { ...IP, Range: asked },
      });
      expect(calls[0].range).toBe(sent);
      if (!sent) expect(res.status).toBe(200);
    },
  );

  it("forwards If-Range with a Range, mirrors ETag and Last-Modified", async () => {
    const t = await issue(["t1"]);
    const seen: (string | undefined)[] = [];
    const drive = {
      async streamFile(_id: string, o?: StreamOptions) {
        seen.push(o?.ifRange);
        return new Response(TIFF_HEAD.slice(0, 2), {
          status: 206,
          headers: {
            "Content-Range": "bytes 0-1/8",
            ETag: '"v9"',
            "Last-Modified": "Wed, 01 Jan 2026 00:00:00 GMT",
            "Accept-Ranges": "bytes",
          },
        });
      },
    } as unknown as DriveClient;
    const res = await dl(tokenOf(t.tokens[0].url), drive, {
      headers: { ...IP, Range: "bytes=0-1", "If-Range": '"v9"' },
    });
    expect(seen).toEqual(['"v9"']);
    expect(res.headers.get("ETag")).toBe('"v9"');
    expect(res.headers.get("Last-Modified")).toContain("2026");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it("If-Range without a Range is not forwarded; without any validator from Drive no resumability is claimed", async () => {
    const t = await issue(["t1"]);
    const seen: (string | undefined)[] = [];
    const drive = {
      async streamFile(_id: string, o?: StreamOptions) {
        seen.push(o?.ifRange);
        return new Response(TIFF_HEAD.slice(), {
          headers: { "Accept-Ranges": "bytes", "Content-Length": "8" },
        });
      },
    } as unknown as DriveClient;
    const res = await dl(tokenOf(t.tokens[0].url), drive, {
      headers: { ...IP, "If-Range": '"v9"' },
    });
    expect(seen).toEqual([undefined]);
    expect(res.headers.get("Accept-Ranges")).toBeNull();
  });

  it("is piped, not buffered: the response is returned before the body is read and pulls follow the reader", async () => {
    const t = await issue(["t1"]);
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          pulls++;
          if (pulls > 1000) c.close();
          else c.enqueue(new Uint8Array(64 * 1024));
        },
      },
      { highWaterMark: 0 },
    );
    const { drive } = driveFor({
      headers: { "Content-Type": "image/tiff" },
      body,
    });
    const res = await dl(tokenOf(t.tokens[0].url), drive);
    expect(pulls).toBeLessThan(5); // nothing read ahead: no 64 MB buffered
    const reader = res.body!.getReader();
    await reader.read();
    await reader.read();
    expect(pulls).toBeLessThan(10);
    await reader.cancel();
  });

  it("never touches the R2 cache", async () => {
    const t = await issue(["t1"]);
    const { drive } = driveFor({ body: TIFF_HEAD.slice() });
    await (await dl(tokenOf(t.tokens[0].url), drive)).arrayBuffer();
    expect((await env.CACHE.list()).objects).toEqual([]);
  });

  it("a HEAD costs no download row and cancels the body", async () => {
    const t = await issue(["t1"]);
    const { drive } = driveFor({
      headers: { "Content-Length": "8" },
      body: TIFF_HEAD.slice(),
    });
    const res = await dl(tokenOf(t.tokens[0].url), drive, {
      method: "HEAD",
      headers: IP,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/tiff");
    expect(await db.select().from(schema.downloads)).toEqual([]);
  });

  it("logs the download with variant highres (one row)", async () => {
    const t = await issue(["t1"]);
    const { drive } = driveFor({ body: TIFF_HEAD.slice() });
    await dl(tokenOf(t.tokens[0].url), drive);
    expect(await db.select().from(schema.downloads)).toMatchObject([
      { photoId: "t1", variant: "highres", kind: "single" },
    ]);
  });
});

describe("T6.53d Prueba and bulk never deliver a TIFF", () => {
  it("Prueba: no token for the TIFF (403), and a token signed earlier is refused once the album is Prueba (410)", async () => {
    await gallery();
    await photos();
    const t = await issue(["t1"]);
    await db.update(schema.galleries).set({ mode: "proofing" });
    const now = await tokens({ photoIds: ["t1"], variant: "highres" });
    expect(now.status).toBe(403);
    const { drive, calls } = driveFor({ body: TIFF_HEAD.slice() });
    const res = await dl(tokenOf(t.tokens[0].url), drive);
    expect(res.status).toBe(410);
    expect(calls).toEqual([]); // Drive was not even asked
  });

  it("a multi-photo (bulk) token request lists the TIFF as unavailable and signs none for it", async () => {
    await gallery();
    await photos();
    const r = await issue(["t1", "j1", "m1"]);
    expect(r.tokens.map((t) => t.photoId)).toEqual(["j1"]);
    expect(r.unavailable.sort()).toEqual(["m1", "t1"]);
  });

  it("a bulk token of another size still works for the TIFF photos' JPEG sizes", async () => {
    await gallery();
    await photos();
    const r = await issue(["t2", "j1"], "web");
    expect(r.tokens.map((t) => t.photoId).sort()).toEqual(["j1", "t2"]);
  });

  it("/dl refuses a bulk-tagged token for a TIFF even if one was signed (defence in depth)", async () => {
    await gallery();
    await photos();
    const { signToken } = await import("../app/lib/server/crypto");
    const { accessFingerprint } = await import("../app/lib/server/access");
    const { findGallery } = await import("../app/lib/server/access");
    const g = (await findGallery(env, "retoque"))!;
    const token = await signToken(
      {
        t: "dl",
        jti: "j-1",
        g: GID,
        p: "t1",
        v: "highres",
        vid: "v",
        pf: await accessFingerprint(g, env),
        b: "multi",
      },
      env.DOWNLOAD_SECRET,
      600,
    );
    const { drive, calls } = driveFor({ body: TIFF_HEAD.slice() });
    expect((await dl(token, drive)).status).toBe(410);
    expect(calls).toEqual([]);
  });

  it("/bulk (zip list) leaves the TIFF photos out of a high-res run and says how many", async () => {
    await gallery();
    await photos();
    const res = await handleBulk(
      post("/api/g/retoque/bulk", { scope: "all", variant: "highres" }),
      "retoque",
      env,
    );
    const body = (await res.json()) as {
      photoIds: string[];
      skippedTiff?: number;
      totalBytes?: number;
    };
    expect(body.photoIds).toEqual(["j1"]);
    expect(body.skippedTiff).toBe(3);
    expect(body.totalBytes).toBe(1000);
  });

  it("/bulk of the web size keeps the photos that have a web JPEG, TIFF or not", async () => {
    await gallery();
    await photos();
    const res = await handleBulk(
      post("/api/g/retoque/bulk", { scope: "all", variant: "web" }),
      "retoque",
      env,
    );
    const body = (await res.json()) as {
      photoIds: string[];
      skippedTiff?: number;
    };
    expect(body.photoIds.sort()).toEqual(["j1", "t2"]);
    expect(body.skippedTiff).toBeUndefined();
  });
});

describe("T6.53d Drive errors: generic message, a retry hint, no leakage", () => {
  beforeEach(async () => {
    await gallery();
    await photos();
  });
  const SECRET = "TIF-t1 secret-detail";
  const failing = (status: number, reason?: string) =>
    driveFor(new DriveError(status, "Drive request failed", SECRET, reason));

  it.each([
    [404, 410, null],
    [403, 410, null], // permission revoked / download not allowed: no retry
    [429, 503, "300"],
    [500, 502, "60"],
    [503, 502, "60"],
    [400, 502, "60"],
  ])("Drive %i -> %i with Retry-After %s", async (up, out, retry) => {
    const t = await issue(["t1"]);
    const res = await dl(tokenOf(t.tokens[0].url), failing(up).drive);
    expect(res.status).toBe(out);
    expect(res.headers.get("Retry-After")).toBe(retry);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const text = await res.text();
    expect(text).not.toMatch(/TIF-|secret|hr-|Drive request/);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    // Spanish and English, the way the rest of the app answers visitors.
    if (out !== 410) expect(text).toMatch(/Probá de nuevo[\s\S]*Try again/);
    else
      expect(text).toMatch(/ya no está disponible[\s\S]*no longer available/);
  });

  it.each([
    "rateLimitExceeded",
    "userRateLimitExceeded",
    "downloadQuotaExceeded",
    "dailyLimitExceeded",
  ])(
    "Drive 403 with the quota reason %s -> 503, Retry-After 300",
    async (reason) => {
      const t = await issue(["t1"]);
      const res = await dl(
        tokenOf(t.tokens[0].url),
        failing(403, reason).drive,
      );
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("300");
    },
  );

  it("Drive 403 with another reason (cannotDownloadFile) -> 410, no retry hint", async () => {
    const t = await issue(["t1"]);
    const res = await dl(
      tokenOf(t.tokens[0].url),
      failing(403, "cannotDownloadFile").drive,
    );
    expect(res.status).toBe(410);
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("416 stays a bare 416", async () => {
    const t = await issue(["t1"]);
    const res = await dl(tokenOf(t.tokens[0].url), failing(416).drive);
    expect(res.status).toBe(416);
  });

  it("Drive answering a web page (e.g. a 'too large to scan' interstitial) with 200 is an error, not a corrupt .tif", async () => {
    const t = await issue(["t1"]);
    const { drive } = driveFor({
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: "<html>Google Drive can't scan this file for viruses</html>",
    });
    const res = await dl(tokenOf(t.tokens[0].url), drive);
    expect(res.status).toBe(502);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.text()).not.toContain("Google");
  });

  it("a JPEG download keeps its exact old error shapes (502 'Bad gateway', no Retry-After)", async () => {
    const t = await issue(["j1"]);
    const res = await dl(tokenOf(t.tokens[0].url), failing(500).drive);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("Bad gateway");
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("a failure in the middle of the stream errors the response (the browser's download fails and can be resumed with Range), without leaking", async () => {
    const t = await issue(["t1"]);
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (!sent) {
          sent = true;
          c.enqueue(TIFF_HEAD.slice());
        } else c.error(new Error(`socket reset for ${SECRET}`));
      },
    });
    const { drive } = driveFor({
      headers: {
        "Content-Type": "image/tiff",
        "Accept-Ranges": "bytes",
        ETag: '"v1"',
      },
      body,
    });
    const res = await dl(tokenOf(t.tokens[0].url), drive);
    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    await expect(res.arrayBuffer()).rejects.toThrow();
  });
});
