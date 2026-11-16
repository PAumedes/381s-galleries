import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../app/db";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}

const db = getDb(env);

async function seed() {
  const [g] = await db
    .insert(schema.galleries)
    .values({ driveFolderId: "f1", slug: "s1", title: "T" })
    .returning();
  await db.insert(schema.photos).values([
    { galleryId: g.id, baseName: "a", driveHighresId: "d1", sort: 1 },
    { galleryId: g.id, baseName: "b", driveHighresId: "d2", sort: 2 },
  ]);
  return g;
}

describe("db", () => {
  beforeAll(async () => {
    await applyD1Migrations(
      env.DB,
      (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
    );
  });

  it("inserts and reads gallery + photos with defaults", async () => {
    const g = await seed();
    expect(g.status).toBe("draft");
    expect(g.allowHighres).toBe(true);
    expect(g.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} /);
    const rows = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.galleryId, g.id));
    expect(rows).toHaveLength(2);
    expect(rows[0].setName).toBe("Highlights");
  });

  it("rejects duplicate (gallery_id, set_name, base_name)", async () => {
    const [g] = await db
      .insert(schema.galleries)
      .values({ driveFolderId: "f2", slug: "s2", title: "T2" })
      .returning();
    const p = { galleryId: g.id, baseName: "x", driveHighresId: "d" };
    await db.insert(schema.photos).values(p);
    await expect(db.insert(schema.photos).values(p)).rejects.toThrow();
  });

  it("cascades gallery deletion to photos", async () => {
    const [g] = await db
      .insert(schema.galleries)
      .values({ driveFolderId: "f3", slug: "s3", title: "T3" })
      .returning();
    await db
      .insert(schema.photos)
      .values({ galleryId: g.id, baseName: "y", driveHighresId: "d" });
    await db.delete(schema.galleries).where(eq(schema.galleries.id, g.id));
    const rows = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.galleryId, g.id));
    expect(rows).toHaveLength(0);
  });
});
