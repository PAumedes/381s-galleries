import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { loadGallery } from "../../app/lib/server/gallery";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000bb";
beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables("gallery_views", "photos", "galleries");
});

describe("P2 review: missing CF-Connecting-IP outside mock mode", () => {
  it("cookieless loads without an IP header are still deduped (was one 'unknown' bucket before the refactor)", async () => {
    await db.insert(schema.galleries).values({
      id: G,
      driveFolderId: "f",
      slug: "boda",
      title: "B",
      status: "published",
    });
    const prod = {
      DB: env.DB,
      SESSION_SECRET: env.SESSION_SECRET,
    } as typeof env;
    for (let i = 0; i < 20; i++) {
      await loadGallery(new Request("https://x.test/boda"), "boda", prod);
    }
    const r = await env.DB.prepare(
      "SELECT COUNT(*) c FROM gallery_views",
    ).first<{ c: number }>();
    expect(r!.c).toBeLessThan(20);
  });
});
