import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { hashPin } from "../../app/lib/server/crypto";
import {
  PIN_GALLERY_MAX_ATTEMPTS,
  unlockGallery,
} from "../../app/lib/server/gallery";

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

async function setup() {
  await resetTables("rate_limits", "galleries");
  await db.insert(schema.galleries).values({
    id: "gPIN",
    driveFolderId: "f",
    slug: "boda",
    title: "B",
    status: "published",
    pinHash: await hashPin("482193"),
  });
}

it("successful unlocks do not refresh the gallery-wide wrong-guess budget", async () => {
  await setup();
  let evaluated = 0;
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < PIN_GALLERY_MAX_ATTEMPTS - 1; i++) {
      const r = await unlockGallery(
        post("000000", `10.${round}.${i >> 8}.${i & 255}`),
        "boda",
        env,
      );
      if (r.status === 400) evaluated++;
    }
    const ok = await unlockGallery(
      post("482193", `172.16.0.${round + 1}`),
      "boda",
      env,
    );
    expect([303, 429]).toContain(ok.status);
  }
  expect(evaluated).toBeLessThanOrEqual(PIN_GALLERY_MAX_ATTEMPTS);
}, 60_000);

it("a guest can still unlock repeatedly while few wrong guesses were made", async () => {
  await setup();
  for (let i = 0; i < 150; i++) {
    const r = await unlockGallery(
      post("482193", `172.20.${i >> 8}.${i & 255}`),
      "boda",
      env,
    );
    expect(r.status).toBe(303);
  }
}, 60_000);
