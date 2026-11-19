import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { galleryMeta } from "../../app/lib/og";
import { loadGallery } from "../../app/lib/server/gallery";
import { serveImage } from "../../app/lib/server/images";
import type { DriveClient } from "../../app/lib/server/drive-types";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000a1";
const googleEnv = { ...env, DRIVE_MODE: "google" } as Env;

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables("gallery_views", "photos", "galleries");
});
const req = (headers: Record<string, string> = {}) =>
  new Request("https://session.test/wm", { headers });

describe("T5.1 og:image must be fetchable by a cookieless crawler", () => {
  it("watermark on + cover without preview-wm: og:image URL 404s, so it must not be advertised", async () => {
    await db.insert(schema.galleries).values({
      id: G,
      driveFolderId: "f",
      slug: "wm",
      title: "WM",
      status: "published",
      mode: "proofing",
    });
    await db.insert(schema.photos).values([
      {
        id: "p1",
        galleryId: G,
        baseName: "A",
        driveHighresId: "h1",
        driveWebId: "w1",
        width: 3000,
        height: 2000,
        sort: 1,
      },
      {
        id: "p2",
        galleryId: G,
        baseName: "B",
        driveHighresId: "h2",
        driveWmId: "wm2",
        width: 3000,
        height: 2000,
        sort: 2,
      },
    ]);
    const d = (await loadGallery(req(), "wm", env)).data;
    const tags = galleryMeta(d, {
      studio: "S",
      lang: "es",
      origin: "https://x.test",
    });
    const img = tags.find((t) => t.property === "og:image")?.content;
    if (!img) return; // not advertised: fine
    const path = new URL(img).pathname.split("/");
    const res = await serveImage(
      new Request(img),
      { photoId: path[2], variant: path[3] },
      googleEnv,
      { waitUntil() {} },
      {
        drive: {
          streamFile: async () => new Response("x"),
        } as unknown as DriveClient,
      },
    );
    expect(res.status).toBe(200);
  });
});

describe("T5.1 preview bots must not count as views", () => {
  it.each([
    "http.rb/5.1.1 (Mastodon/4.2.0; +https://mastodon.example/)",
    "Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)",
    "Iframely/1.3.1 (+https://iframely.com/docs/about)",
  ])("UA %s is not logged", async (ua) => {
    await db.insert(schema.galleries).values({
      id: G,
      driveFolderId: "f",
      slug: "wm",
      title: "WM",
      status: "published",
    });
    await loadGallery(
      req({ "User-Agent": ua, "CF-Connecting-IP": "1.2.3.4" }),
      "wm",
      env,
    );
    const n = await env.DB.prepare(
      "SELECT count(*) AS n FROM gallery_views",
    ).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});
