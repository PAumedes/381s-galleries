import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import type {
  DriveClient,
  StreamOptions,
} from "../../app/lib/server/drive-types";
import {
  handleDownloadTokens,
  serveDownload,
} from "../../app/lib/server/downloads";
import { clearCache } from "../support/cache";

const db = getDb(env);
const GID = "gggggggg-0000-0000-0000-0000000000f2";
const IP = { "CF-Connecting-IP": "8.8.4.4" };
const e = { ...env, DRIVE_MODE: "google" } as Env;

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
  await db.insert(schema.galleries).values({
    id: GID,
    driveFolderId: "f",
    slug: "r",
    title: "R",
    status: "published",
    requireEmail: false,
  });
  await db.insert(schema.photos).values({
    id: "t1",
    galleryId: GID,
    baseName: "IMG",
    driveHighresId: "TIF",
    driveTiffId: "TIF",
    highresBytes: 9,
    sort: 1,
  });
});

async function token() {
  const res = await handleDownloadTokens(
    new Request("https://x.test/api/g/r/download-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...IP },
      body: JSON.stringify({ photoIds: ["t1"], variant: "highres" }),
    }),
    "r",
    e,
  );
  const j = (await res.json()) as { tokens: { url: string }[] };
  return j.tokens[0].url.replace("/dl/", "");
}
const dl = (
  t: string,
  up: () => Response,
  headers: Record<string, string> = {},
  calls: (string | undefined)[] = [],
) =>
  serveDownload(
    new Request(`https://x.test/dl/${t}`, { headers: { ...IP, ...headers } }),
    t,
    e,
    {
      drive: {
        async streamFile(_id: string, o?: StreamOptions) {
          calls.push(o?.range);
          return up();
        },
      } as unknown as DriveClient,
    },
  );

describe("T6.53d adversary: /dl TIFF range handling", () => {
  it("a multi-range request must not get a multipart/byteranges body labelled image/tiff", async () => {
    const t = await token();
    const calls: (string | undefined)[] = [];
    const res = await dl(
      t,
      () =>
        new Response("--B\r\nContent-Range: bytes 0-1/9\r\n\r\nII\r\n--B--", {
          status: 206,
          headers: { "Content-Type": "multipart/byteranges; boundary=B" },
        }),
      { Range: "bytes=0-1,5-6" },
      calls,
    );
    const forwarded = calls[0];
    // either the comma range never reaches Drive (single-range only) or the upstream type is kept
    const ok =
      !forwarded?.includes(",") ||
      res.headers.get("Content-Type") !== "image/tiff";
    expect(
      ok,
      `Range ${forwarded} forwarded, answered ${res.headers.get("Content-Type")}`,
    ).toBe(true);
  });

  it("mirrors the validators (ETag / Last-Modified) so a browser can resume a multi-GB TIFF with Range", async () => {
    const t = await token();
    const res = await dl(
      t,
      () =>
        new Response("II*\0", {
          status: 200,
          headers: {
            "Content-Length": "4",
            "Accept-Ranges": "bytes",
            ETag: '"abc"',
            "Last-Modified": "Wed, 01 Jan 2026 00:00:00 GMT",
          },
        }),
    );
    expect(
      res.headers.get("ETag") ?? res.headers.get("Last-Modified"),
    ).not.toBeNull();
  });
});
