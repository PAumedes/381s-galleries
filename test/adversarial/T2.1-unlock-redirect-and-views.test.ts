import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, nowIso, schema } from "../../app/db";
import { hashPin } from "../../app/lib/server/crypto";
import { loadGallery, unlockGallery } from "../../app/lib/server/gallery";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000aa";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM gallery_views"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM photos"),
    env.DB.prepare("DELETE FROM galleries"),
  ]);
});
const add = (over: Partial<typeof schema.galleries.$inferInsert> = {}) =>
  db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "boda",
    title: "B",
    status: "published",
    ...over,
  });
const post = (
  url: string,
  pin: string,
  headers: Record<string, string> = {},
) => {
  const body = new FormData();
  body.set("pin", pin);
  return new Request(url, { method: "POST", body, headers });
};

describe("T2.1 adversarial", () => {
  it("unlock redirect never produces a protocol-relative Location", async () => {
    await add({ pinHash: await hashPin("1234") });
    const r = await unlockGallery(
      post("https://x.test//evil.example/boda", "1234", {
        "CF-Connecting-IP": "1.1.1.1",
      }),
      "boda",
      env,
    );
    expect(r.status).toBe(303);
    if (r.status === 303) expect(r.location.startsWith("//")).toBe(false);
  });

  it("no-PIN unlock redirect never produces a protocol-relative Location", async () => {
    await add();
    const r = await unlockGallery(
      post("https://x.test//evil.example/boda", ""),
      "boda",
      env,
    );
    if (r.status === 303) expect(r.location.startsWith("//")).toBe(false);
  });

  it("cookieless loads do not inflate gallery_views without bound", async () => {
    await add();
    for (let i = 0; i < 30; i++) {
      await loadGallery(new Request("https://x.test/boda"), "boda", env);
    }
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) c FROM gallery_views",
    ).first<{ c: number }>();
    expect(rows!.c).toBeLessThan(30);
  });

  it("expiry uses instants, not string order, for offset timestamps", async () => {
    // Expires 1h in the future, written with a -12:00 offset.
    const inst = new Date(Date.now() + 3_600_000 - 12 * 3_600_000);
    const local = nowIso(inst).replace("Z", "-12:00");
    await add({ expiresAt: local });
    const r = await loadGallery(
      new Request("https://x.test/boda"),
      "boda",
      env,
    );
    expect(r.data.state).toBe("open");
  });
});
