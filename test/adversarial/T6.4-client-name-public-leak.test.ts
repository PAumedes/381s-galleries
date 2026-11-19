import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { loadGallery } from "../../app/lib/server/gallery";

const db = getDb(env);
beforeAll(async () => {
  await migrateDb();
});

it("T6.4: client name is admin-only (PLAN 5.7) and must not be in the public loader payload", async () => {
  await db.delete(schema.galleries);
  await db.insert(schema.galleries).values({
    id: "cccccccc-0000-0000-0000-0000000000c1",
    driveFolderId: "f",
    slug: "boda-secreta",
    title: "Boda",
    clientName: "Cliente Privado SA",
    status: "published",
  });
  const r = await loadGallery(
    new Request("https://x.test/boda-secreta"),
    "boda-secreta",
    env,
  );
  expect(r.status).toBe(200);
  expect(JSON.stringify(r.data)).not.toContain("Cliente Privado SA");
});
