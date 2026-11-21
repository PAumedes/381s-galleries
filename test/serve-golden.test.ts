import { clearCache } from "./support/cache";
import { shape } from "./support/http";
import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { DriveError } from "../app/lib/server/drive-types";
import type { DriveClient, StreamOptions } from "../app/lib/server/drive-types";
import { serveImage } from "../app/lib/server/images";
import {
  handleBulk,
  handleDownloadTokens,
  serveDownload,
} from "../app/lib/server/downloads";

/**
 * T6.38 characterization: the exact wire shape (status, body, headers) of
 * serveImage, serveDownload and handleBulk across their decision branches.
 * Pins behaviour while the three functions are split into named steps.
 */
const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000e1";
const BASE = "https://golden.test";
const IP = { "CF-Connecting-IP": "8.8.8.8" };
const googleEnv = { ...env, DRIVE_MODE: "google" } as Env;
const mockEnv = { ...env, DRIVE_MODE: "mock" } as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);

beforeAll(async () => {
  await migrateDb();
});
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
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f-g",
    slug: "golden",
    title: "G",
    status: "published",
    requireEmail: false,
  });
  for (const [id, set, sort] of [
    ["p1", "A", 1],
    ["p2", "A", 2],
    ["p3", "B", 3],
  ] as const)
    await db.insert(schema.photos).values({
      id,
      galleryId: G,
      baseName: `IMG_${id}`,
      driveHighresId: `hr-${id}`,
      driveWebId: id === "p3" ? null : `web-${id}`,
      driveThumbId: `th-${id}`,
      variantVersions: JSON.stringify({
        highres: "2026-01-01T00:00:01Z",
        web: "2026-01-01T00:00:02Z",
        thumb: "2026-01-01T00:00:03Z",
      }),
      highresBytes: 1000,
      setName: set,
      sort,
      width: 3000,
      height: 2000,
    });
});

type Opts = { status?: number; noLength?: boolean; empty?: boolean };
function fakeDrive(o: Opts = {}) {
  const calls: { id: string; range?: string }[] = [];
  const drive = {
    async streamFile(id: string, so?: StreamOptions) {
      calls.push({ id, range: so?.range });
      if (o.status) throw new DriveError(o.status, "x", "detail");
      if (so?.range)
        return new Response(JPEG.slice(2, 5), {
          status: 206,
          headers: {
            "Content-Length": "3",
            "Content-Range": `bytes 2-4/${JPEG.length}`,
            "Content-Type": "image/jpeg",
          },
        });
      const headers: Record<string, string> = { "Content-Type": "image/webp" };
      if (!o.noLength)
        headers["Content-Length"] = String(o.empty ? 0 : JPEG.length);
      return new Response(o.empty ? new Uint8Array() : JPEG.slice(), {
        status: 200,
        headers,
      });
    },
  } as unknown as DriveClient;
  return { drive, calls };
}

async function img(
  variant: string,
  o: {
    e?: Env;
    drive?: DriveClient;
    query?: string;
    headers?: Record<string, string>;
    opts?: { admin?: boolean };
    photoId?: string;
  } = {},
) {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
  } as unknown as ExecutionContext;
  const photoId = o.photoId ?? "p1";
  const res = await serveImage(
    new Request(`${BASE}/img/${photoId}/${variant}${o.query ?? ""}`, {
      headers: { ...IP, ...o.headers },
    }),
    { photoId, variant },
    o.e ?? googleEnv,
    ctx,
    { drive: o.drive ?? fakeDrive().drive },
    o.opts,
  );
  await Promise.all(pending);
  return res;
}

const post = (path: string, body: unknown) =>
  new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...IP },
    body: JSON.stringify(body),
  });
async function token(photoId: string, variant = "highres") {
  const res = await handleDownloadTokens(
    post("/api/g/golden/download-tokens", { photoIds: [photoId], variant }),
    "golden",
    env,
  );
  const b = (await res.json()) as { tokens: { url: string }[] };
  return b.tokens[0].url.replace("/dl/", "");
}
const dl = (
  tok: string,
  d: DriveClient,
  init: RequestInit = {},
  e: Env = googleEnv,
) =>
  serveDownload(
    new Request(`${BASE}/dl/${tok}`, {
      ...init,
      headers: { ...IP, ...(init.headers as object) },
    }),
    tok,
    e,
    {
      drive: d,
    },
  );

/** One line per response: status, then the headers that matter, then body length. */
async function line(res: Response) {
  const s = await shape(res);
  const h = Object.entries(s.headers).map(([k, v]) => `${k}=${v}`);
  return [s.status, ...h, `body=${s.body.length}`].join(" | ");
}

describe("T6.38 serveImage golden", () => {
  it("decision branches", async () => {
    const out: Record<string, string> = {};
    out.badVariant = await line(await img("huge"));
    out.adminLg = await line(await img("view-lg", { opts: { admin: true } }));
    out.noPhoto = await line(await img("thumb", { photoId: "nope" }));
    out.mock = await line(await img("view-sm", { e: mockEnv }));
    out.missNoVersionAsked = await line(await img("thumb"));
    out.hit = await line(await img("thumb"));
    const asked = await img("thumb", { query: "?v=bogus" });
    out.hitBogusV = await line(asked);
    const etag = asked.headers.get("ETag") ?? "";
    out.hit304 = await line(
      await img("thumb", { headers: { "If-None-Match": etag } }),
    );
    out.noLength = await line(
      await img("view-sm", { drive: fakeDrive({ noLength: true }).drive }),
    );
    out.zeroLength = await line(
      await img("view-lg", { drive: fakeDrive({ empty: true }).drive }),
    );
    out.drive404 = await line(
      await img("view-lg", {
        photoId: "p2",
        drive: fakeDrive({ status: 404 }).drive,
      }),
    );
    out.drive500 = await line(
      await img("view-lg", {
        photoId: "p2",
        drive: fakeDrive({ status: 500 }).drive,
      }),
    );
    out.adminMiss = await line(
      await img("view-sm", { photoId: "p2", opts: { admin: true } }),
    );
    out.adminWm = await line(
      await img("view-sm-wm", { photoId: "p2", opts: { admin: true } }),
    );
    out.publicAdminWm = await line(await img("view-sm-wm", { photoId: "p2" }));
    expect(out).toMatchInlineSnapshot(`
      {
        "adminLg": "404 | cache-control=no-store | content-type=text/plain; charset=utf-8 | x-content-type-options=nosniff | body=9",
        "adminMiss": "200 | cache-control=private, no-store | content-length=9 | content-type=image/webp | x-content-type-options=nosniff | body=9",
        "adminWm": "404 | cache-control=no-store | content-type=text/plain; charset=utf-8 | x-content-type-options=nosniff | body=9",
        "badVariant": "404 | cache-control=no-store | content-type=text/plain; charset=utf-8 | x-content-type-options=nosniff | body=9",
        "drive404": "404 | cache-control=no-store | content-type=text/plain; charset=utf-8 | x-content-type-options=nosniff | body=9",
        "drive500": "502 | cache-control=no-store | content-type=text/plain; charset=utf-8 | x-content-type-options=nosniff | body=11",
        "hit": "200 | cache-control=private, max-age=600 | content-length=9 | content-type=image/webp | etag="c00078e5ba28326291ebd86366b3c822" | x-content-type-options=nosniff | body=9",
        "hit304": "304 | cache-control=private, max-age=600 | etag="c00078e5ba28326291ebd86366b3c822" | x-content-type-options=nosniff | body=0",
        "hitBogusV": "200 | cache-control=private, max-age=600 | content-length=9 | content-type=image/webp | etag="c00078e5ba28326291ebd86366b3c822" | x-content-type-options=nosniff | body=9",
        "missNoVersionAsked": "200 | cache-control=private, max-age=600 | content-length=9 | content-type=image/webp | x-content-type-options=nosniff | body=9",
        "mock": "302 | cache-control=private, max-age=3600 | location=https://picsum.photos/seed/p1/1200/800 | x-content-type-options=nosniff | body=0",
        "noLength": "200 | cache-control=private, max-age=600 | content-type=image/webp | x-content-type-options=nosniff | body=9",
        "noPhoto": "404 | cache-control=no-store | content-type=text/plain; charset=utf-8 | x-content-type-options=nosniff | body=9",
        "publicAdminWm": "404 | cache-control=no-store | content-type=text/plain; charset=utf-8 | x-content-type-options=nosniff | body=9",
        "zeroLength": "502 | cache-control=no-store | content-type=text/plain; charset=utf-8 | x-content-type-options=nosniff | body=11",
      }
    `);
  });

  it("proofing gallery without watermark file is a 404; draft is a 404", async () => {
    await db.update(schema.galleries).set({ mode: "proofing" });
    const a = await line(await img("thumb"));
    await db
      .update(schema.galleries)
      .set({ mode: "delivery", status: "draft" });
    const b = await line(await img("thumb", { photoId: "p2" }));
    expect({ a, b }).toMatchInlineSnapshot(`
      {
        "a": "404 | cache-control=no-store | content-type=text/plain; charset=utf-8 | x-content-type-options=nosniff | body=9",
        "b": "404 | cache-control=no-store | content-type=text/plain; charset=utf-8 | x-content-type-options=nosniff | body=9",
      }
    `);
  });

  it("repeated R2 misses under the per-IP limit all pass", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 3; i++)
      lines.push(
        (
          await line(await img("thumb", { photoId: "p2", opts: undefined }))
        ).slice(0, 3),
      );
    expect(lines).toMatchInlineSnapshot(`
      [
        "200",
        "200",
        "200",
      ]
    `);
  });
});

describe("T6.38 serveDownload golden", () => {
  it("decision branches", async () => {
    const out: Record<string, string> = {};
    const f = fakeDrive();
    out.badToken = await line(await dl("garbage", f.drive));
    const t1 = await token("p1");
    out.mock = await line(await dl(t1, f.drive, {}, mockEnv));
    const t2 = await token("p1");
    out.full = await line(await dl(t2, f.drive));
    const t3 = await token("p1");
    out.range = await line(
      await dl(t3, f.drive, { headers: { Range: "bytes=2-4" } }),
    );
    const t4 = await token("p1");
    out.head = await line(await dl(t4, f.drive, { method: "HEAD" }));
    const t5 = await token("p2");
    out.d404 = await line(await dl(t5, fakeDrive({ status: 404 }).drive));
    const t6 = await token("p2");
    out.d416 = await line(await dl(t6, fakeDrive({ status: 416 }).drive));
    const t7 = await token("p2");
    out.d500 = await line(await dl(t7, fakeDrive({ status: 500 }).drive));
    out.rows = String((await db.select().from(schema.downloads)).length);
    await db.update(schema.galleries).set({ status: "archived" });
    out.archived = await line(
      await dl(await token("p1").catch(() => "x"), f.drive),
    );
    expect(out).toMatchInlineSnapshot(`
      {
        "archived": "410 | cache-control=private, no-store | content-type=text/plain; charset=utf-8 | referrer-policy=no-referrer | x-content-type-options=nosniff | body=4",
        "badToken": "410 | cache-control=private, no-store | content-type=text/plain; charset=utf-8 | referrer-policy=no-referrer | x-content-type-options=nosniff | body=4",
        "d404": "410 | cache-control=private, no-store | content-type=text/plain; charset=utf-8 | referrer-policy=no-referrer | x-content-type-options=nosniff | body=4",
        "d416": "416 | cache-control=private, no-store | body=0",
        "d500": "502 | cache-control=private, no-store | content-type=text/plain; charset=utf-8 | referrer-policy=no-referrer | x-content-type-options=nosniff | body=11",
        "full": "200 | cache-control=private, no-store | content-disposition=attachment; filename="IMG_p1.jpg"; filename*=UTF-8''IMG_p1.jpg | content-length=9 | content-type=image/webp | referrer-policy=no-referrer | x-content-type-options=nosniff | body=9",
        "head": "200 | cache-control=private, no-store | content-disposition=attachment; filename="IMG_p1.jpg"; filename*=UTF-8''IMG_p1.jpg | content-length=9 | content-type=image/webp | referrer-policy=no-referrer | x-content-type-options=nosniff | body=0",
        "mock": "302 | cache-control=private, no-store | location=https://picsum.photos/seed/p1/2048/1365 | referrer-policy=no-referrer | x-content-type-options=nosniff | body=0",
        "range": "206 | cache-control=private, no-store | content-disposition=attachment; filename="IMG_p1.jpg"; filename*=UTF-8''IMG_p1.jpg | content-length=3 | content-range=bytes 2-4/9 | content-type=image/jpeg | referrer-policy=no-referrer | x-content-type-options=nosniff | body=3",
        "rows": "3",
      }
    `);
  });

  it("a token can be reused within its use limit", async () => {
    const f = fakeDrive();
    const t = await token("p1", "web");
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) seen.push((await dl(t, f.drive)).status);
    expect(seen).toMatchInlineSnapshot(`
      [
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
        200,
      ]
    `);
  });
});

describe("T6.38 handleBulk golden", () => {
  const bulk = async (body: unknown) => {
    const res = await handleBulk(
      post("/api/g/golden/bulk", body),
      "golden",
      env,
    );
    const s = await shape(res);
    return `${s.status} ${s.body.replace(/"bulkId":"[^"]+"/, '"bulkId":"<id>"')}`;
  };
  it("scopes and refusals", async () => {
    const out: Record<string, string> = {};
    out.all = await bulk({ scope: "all", variant: "highres" });
    out.allWeb = await bulk({ scope: "all", variant: "web" });
    out.setA = await bulk({ scope: "set", set: "A", variant: "highres" });
    out.setNone = await bulk({ scope: "set", set: "Zzz", variant: "highres" });
    out.favoritesEmpty = await bulk({ scope: "favorites", variant: "web" });
    out.badScope = await bulk({ scope: "bogus", variant: "web" });
    out.badSet = await bulk({ scope: "set", set: "", variant: "web" });
    out.badVariant = await bulk({ scope: "all", variant: "raw" });
    await db.update(schema.galleries).set({ allowBulk: false });
    out.bulkOff = await bulk({ scope: "all", variant: "highres" });
    out.rows = JSON.stringify(
      (await db.select().from(schema.downloads)).map((d) => [
        d.kind,
        d.variant,
        d.bulkScope,
      ]),
    );
    expect(out).toMatchInlineSnapshot(`
      {
        "all": "200 {"bulkId":"<id>","photoIds":["p1","p2","p3"],"totalBytes":3000}",
        "allWeb": "200 {"bulkId":"<id>","photoIds":["p1","p2"]}",
        "badScope": "400 {"error":"bad_request"}",
        "badSet": "400 {"error":"bad_request"}",
        "badVariant": "400 {"error":"bad_request"}",
        "bulkOff": "403 {"error":"bulk_disabled"}",
        "favoritesEmpty": "200 {"bulkId":null,"photoIds":[]}",
        "rows": "[["bulk","highres","all"],["bulk","web","all"],["bulk","highres","set:A"]]",
        "setA": "200 {"bulkId":"<id>","photoIds":["p1","p2"],"totalBytes":2000}",
        "setNone": "200 {"bulkId":null,"photoIds":[]}",
      }
    `);
  });
});
