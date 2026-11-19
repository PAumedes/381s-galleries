import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { hashPin } from "../../app/lib/server/crypto";
import { unlockGallery } from "../../app/lib/server/gallery";

const db = getDb(env);
beforeAll(async () => {
  await migrateDb();
});

const post = (pin: string, ip: string) => {
  const body = new FormData();
  body.set("pin", pin);
  return new Request("https://s.test/boda", {
    method: "POST",
    body,
    headers: { "CF-Connecting-IP": ip },
  });
};

it("a 4-digit PIN cannot be guessed by rotating source IPs (no per-gallery cap)", async () => {
  await resetTables("rate_limits", "galleries");
  await db.insert(schema.galleries).values({
    id: "gPIN",
    driveFolderId: "f",
    slug: "boda",
    title: "B",
    status: "published",
    pinHash: await hashPin("4821"),
  });
  // 60 wrong guesses, each from a fresh IPv6 address (one /64 = 2^64 addresses).
  for (let i = 0; i < 60; i++) {
    await unlockGallery(
      post(String(1000 + i), `2001:db8::${i + 1}`),
      "boda",
      env,
    );
  }
  // The gallery as a whole should now be throttled, even for a new IP.
  const r = await unlockGallery(post("4821", "2001:db8::ffff"), "boda", env);
  expect(r.status).toBe(429);
});
