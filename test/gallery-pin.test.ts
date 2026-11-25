import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { hashPin } from "../app/lib/server/crypto";
import { unlockGallery } from "../app/lib/server/gallery";
import { migrateDb, resetTables } from "./support/d1";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000c1";
const URL_ = "https://session.test/boda-ana";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables("rate_limits", "gallery_views", "photos", "galleries");
});

async function addGallery(pinHash: string) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "boda-ana",
    title: "Boda Ana",
    status: "published",
    pinHash,
  });
}
const post = (pin: string, ip = "203.0.113.7") =>
  new Request(URL_, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": ip,
      "Sec-Fetch-Site": "same-origin",
    },
    body: new URLSearchParams({ pin }).toString(),
  });

describe("T6.47 unlockGallery PIN input limits", () => {
  it("an empty PIN is rejected even when the stored hash is the hash of the empty string", async () => {
    await addGallery(await hashPin(""));
    const r = await unlockGallery(post(""), "boda-ana", env);
    expect(r.status).toBe(400);
    expect(r).not.toHaveProperty("setCookie");
  });

  it("a 1 MB PIN does not crash: it is cut to its first 256 chars (the prefix unlocks, the rest is ignored)", async () => {
    const prefix = "x".repeat(255) + "y"; // exactly 256 chars
    await addGallery(await hashPin(prefix));
    const huge = prefix + "z".repeat(1024 * 1024);
    const r = await unlockGallery(post(huge), "boda-ana", env);
    expect(r.status).toBe(303);
    expect(r).toHaveProperty("setCookie");
  });

  it("the cut is at 256, not 255 or 257", async () => {
    // Stored PIN = 255 x's + "y" + "w": only a 257-char cut would match it.
    await addGallery(await hashPin("x".repeat(255) + "yw"));
    const long = "x".repeat(255) + "yw" + "z".repeat(100);
    expect((await unlockGallery(post(long), "boda-ana", env)).status).toBe(400);
  });

  it("a 1 MB wrong PIN is rejected (400) without crashing", async () => {
    await addGallery(await hashPin("1234"));
    const r = await unlockGallery(
      post("b".repeat(1024 * 1024)),
      "boda-ana",
      env,
    );
    expect(r.status).toBe(400);
    expect(r).not.toHaveProperty("setCookie");
  });

  it("a 1 MB PIN for an unknown album is a 404, not a crash", async () => {
    const r = await unlockGallery(post("b".repeat(1024 * 1024)), "nope", env);
    expect(r.status).toBe(404);
  });
});
