import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import {
  DL_MAX_PER_WINDOW,
  handleDownloadTokens,
} from "../../app/lib/server/downloads";
import {
  ANON_MAX_PER_WINDOW,
  handleSetFavorite,
} from "../../app/lib/server/favorites";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000e2";
const BASE = "https://session.test";

beforeAll(async () => {
  await migrateDb();
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
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f-" + G,
    slug: "boda",
    title: "Boda",
    status: "published",
    requireEmail: false,
    allowHighres: true,
  });
  await db.insert(schema.photos).values({
    id: "p1",
    galleryId: G,
    baseName: "IMG_p1",
    driveHighresId: "hr-p1",
    driveWebId: "web-p1",
    driveIgId: "ig-p1",
    highresBytes: 1000,
    width: 3000,
    height: 2000,
    sort: 1,
  });
});

const post = (path: string, body: unknown, ip: string, cookie = "") =>
  new Request(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const v6 = (prefix: string, i: number) => `${prefix}::${(i + 1).toString(16)}`;
const visitorCount = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM visitors").first<{
    n: number;
  }>())!.n;

const anonFav = (ip: string) =>
  handleSetFavorite(
    post("/api/g/boda/favorites", { photoId: "p1", on: true }, ip),
    "boda",
    env,
  );

async function tokenRun(ips: string[]) {
  const first = await handleDownloadTokens(
    post(
      "/api/g/boda/download-tokens",
      { photoIds: ["p1"], variant: "highres" },
      ips[0],
    ),
    "boda",
    env,
  );
  const cookie = first.headers.getSetCookie()[0]?.split(";")[0] ?? "";
  let ok = first.status === 200 ? 1 : 0;
  let limited: Response | null = first.status === 429 ? first : null;
  for (const ip of ips.slice(1)) {
    const r = await handleDownloadTokens(
      post(
        "/api/g/boda/download-tokens",
        { photoIds: ["p1"], variant: "highres" },
        ip,
        cookie,
      ),
      "boda",
      env,
    );
    if (r.status === 200) ok++;
    else if (r.status === 429) limited = r;
  }
  return { ok, limited };
}

describe("SEC-002: IPv6 rotation within a /64", () => {
  it("anonymous visitor creation is capped per /64", async () => {
    for (let i = 0; i < 3 * ANON_MAX_PER_WINDOW; i++) {
      await anonFav(v6("2001:db8:1:2", i));
    }
    expect(await visitorCount()).toBeLessThanOrEqual(ANON_MAX_PER_WINDOW);
  });

  it("download token issuance is capped per /64", async () => {
    const ips = Array.from({ length: DL_MAX_PER_WINDOW + 20 }, (_, i) =>
      v6("2001:db8:1:2", i),
    );
    const { ok, limited } = await tokenRun(ips);
    expect(ok).toBeLessThanOrEqual(DL_MAX_PER_WINDOW);
    expect(limited?.headers.get("Retry-After")).toBeTruthy();
  });

  it("different /64s do not share a limit", async () => {
    for (let i = 0; i < ANON_MAX_PER_WINDOW; i++) {
      await anonFav(v6("2001:db8:1:2", i));
    }
    const before = await visitorCount();
    expect(before).toBe(ANON_MAX_PER_WINDOW);
    const other = await anonFav("2001:db8:1:3::1");
    expect(other.status).toBe(200);
    expect(await visitorCount()).toBe(before + 1);
  });

  it("IPv4 clients keep per-address limits", async () => {
    for (let i = 0; i < ANON_MAX_PER_WINDOW + 5; i++) {
      await anonFav("203.0.113.7");
    }
    expect(await visitorCount()).toBe(ANON_MAX_PER_WINDOW);
    // a neighbouring IPv4 address is unaffected
    const r = await anonFav("203.0.113.8");
    expect(r.status).toBe(200);
    expect(await visitorCount()).toBe(ANON_MAX_PER_WINDOW + 1);
  });
});
