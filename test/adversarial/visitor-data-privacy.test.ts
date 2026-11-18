import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { loadGallery } from "../../app/lib/server/gallery";
import {
  handleDownloadTokens,
  serveDownload,
} from "../../app/lib/server/downloads";
import type { DriveClient } from "../../app/lib/server/drive-types";

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
  await env.DB.batch(
    [
      "downloads",
      "gallery_views",
      "visitors",
      "rate_limits",
      "photos",
      "galleries",
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  for (const [id, slug] of [
    [G, "boda"],
    [G2, "otra"],
  ]) {
    await db.insert(schema.galleries).values({
      id,
      driveFolderId: "f-" + id,
      slug,
      title: slug,
      status: "published",
      requireEmail: false,
    });
  }
  await db.insert(schema.photos).values({
    id: "p1",
    galleryId: G,
    baseName: "IMG_1",
    driveHighresId: "hr-1",
    driveWebId: "web-1",
    width: 3000,
    height: 2000,
    sort: 1,
  });
});

const nav = (ip: string, slug = "boda") =>
  new Request(`${BASE}/${slug}`, {
    headers: { "Sec-Fetch-Mode": "navigate", "CF-Connecting-IP": ip },
  });
const hashes = async () =>
  (
    await env.DB.prepare(
      "SELECT ip_hash FROM gallery_views ORDER BY created_at",
    ).all<{
      ip_hash: string;
    }>()
  ).results.map((r) => r.ip_hash);

describe("visitor ip_hash", () => {
  it("IPv6 addresses of one /64 get the same ip_hash (prefix-based, per requirement)", async () => {
    await loadGallery(nav("2001:db8:abcd:12:aaaa:bbbb:cccc:dddd"), "boda", env);
    await loadGallery(nav("2001:db8:abcd:12:1111:2222:3333:4444"), "boda", env);
    const h = await hashes();
    // privacy-extension rotation inside a /64 must not create unique "visitors",
    // and a full /128 hash of an IPv6 is a stable per-device identifier.
    expect(new Set(h).size).toBe(1);
  });

  it("the same IP is not linkable across galleries via ip_hash", async () => {
    await loadGallery(nav("203.0.113.9", "boda"), "boda", env);
    await loadGallery(nav("203.0.113.9", "otra"), "otra", env);
    const h = await hashes();
    expect(h).toHaveLength(2);
    expect(new Set(h).size).toBe(2);
  });
});

describe("raw IP in the stored User-Agent", () => {
  it("downloads.ua does not keep an IP address that the UA string carries", async () => {
    const drive = {
      async streamFile() {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Length": "3", "Content-Type": "image/jpeg" },
        });
      },
    } as unknown as DriveClient;
    const UA =
      "Mozilla/5.0 (Linux; proxy for 198.51.100.23 via 2001:db8::1) Chrome/120.0";
    const res = await handleDownloadTokens(
      new Request(`${BASE}/api/g/boda/download-tokens`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.5",
        },
        body: JSON.stringify({ photoIds: ["p1"], variant: "web" }),
      }),
      "boda",
      env,
    );
    const token = (
      (await res.json()) as { tokens: { url: string }[] }
    ).tokens[0].url.replace("/dl/", "");
    await serveDownload(
      new Request(`${BASE}/dl/${token}`, {
        headers: { "User-Agent": UA, "CF-Connecting-IP": "203.0.113.5" },
      }),
      token,
      { ...env, DRIVE_MODE: "google" } as Env,
      { drive },
    );
    const [row] = (
      await env.DB.prepare("SELECT ua FROM downloads").all<{ ua: string }>()
    ).results;
    expect(row.ua).not.toMatch(/198\.51\.100\.23|2001:db8::1/);
  });
});

describe("privacy page retention claim", () => {
  // Skipped by decision: stats rows are kept on purpose (no FK); /privacy now says so instead of promising deletion (see privacy-retention.test.ts).
  it.skip("stats rows are deleted with the gallery, as /privacy says", async () => {
    await loadGallery(nav("203.0.113.9"), "boda", env);
    expect((await hashes()).length).toBe(1);
    await env.DB.prepare("DELETE FROM galleries WHERE id = ?1").bind(G).run();
    const n = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM gallery_views WHERE gallery_id = ?1",
    )
      .bind(G)
      .first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});
