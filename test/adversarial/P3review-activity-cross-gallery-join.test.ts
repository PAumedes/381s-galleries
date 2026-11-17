import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { activityQuery } from "../../app/lib/server/activity";

const db = getDb(env);
beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});

it("activity of gallery A never shows an email of a visitor that belongs to gallery B", async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM downloads"),
    env.DB.prepare("DELETE FROM visitors"),
    env.DB.prepare("DELETE FROM galleries"),
  ]);
  for (const [id, slug] of [
    ["gA", "a"],
    ["gB", "b"],
  ])
    await db.insert(schema.galleries).values({
      id,
      driveFolderId: "f" + id,
      slug,
      title: slug,
      status: "published",
    });
  await db
    .insert(schema.visitors)
    .values({ id: "vB", galleryId: "gB", email: "secret@b.example" });
  await db.insert(schema.downloads).values({
    id: "d1",
    galleryId: "gA",
    visitorId: "vB",
    variant: "web",
    kind: "single",
  });
  const rows = await activityQuery(db, "gA");
  expect(rows).toHaveLength(1);
  expect(rows[0].email).toBeNull();
});
