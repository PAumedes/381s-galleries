import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { loadGallery } from "../../app/lib/server/gallery";

const db = getDb(env);
const URL_ = "https://session.test/boda-ana";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables("gallery_views", "rate_limits", "photos", "galleries");
  await db.insert(schema.galleries).values({
    id: "gggggggg-0000-0000-0000-0000000000f1",
    driveFolderId: "d",
    slug: "boda-ana",
    title: "Boda",
    status: "published",
  });
});

const views = async () => (await db.select().from(schema.galleryViews)).length;
const req = (headers: Record<string, string>, method = "GET") =>
  new Request(URL_, {
    method,
    headers: { "Sec-Fetch-Mode": "navigate", ...headers },
    cf: {},
  } as RequestInit);

describe("T6.47 view logging filter (survived mutation: gallery-views.shouldLogView)", () => {
  it("bots / link-preview crawlers do not count as visits", async () => {
    for (const ua of [
      "WhatsApp/2.23",
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
    ])
      await loadGallery(req({ "User-Agent": ua }), "boda-ana", env);
    expect(await views()).toBe(0);
  });
  it("HEAD requests do not count as visits", async () => {
    await loadGallery(req({}, "HEAD"), "boda-ana", env);
    expect(await views()).toBe(0);
  });
  it("prefetch does not count as a visit", async () => {
    await loadGallery(req({ "Sec-Purpose": "prefetch" }), "boda-ana", env);
    expect(await views()).toBe(0);
  });
  it("a real browser does count (control)", async () => {
    await loadGallery(
      req({
        "User-Agent": "Mozilla/5.0 Safari",
        "CF-Connecting-IP": "203.0.113.5",
      }),
      "boda-ana",
      env,
    );
    expect(await views()).toBe(1);
  });
});
