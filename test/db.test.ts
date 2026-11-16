import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, nowIso, photoVisible, schema } from "../app/db";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}

const db = getDb(env);

async function seed() {
  const [g] = await db
    .insert(schema.galleries)
    .values({
      driveFolderId: `f-${crypto.randomUUID()}`,
      slug: `s-${crypto.randomUUID()}`,
      title: "T",
    })
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
    expect(g.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
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
      .values({
        driveFolderId: `f-${crypto.randomUUID()}`,
        slug: `s-${crypto.randomUUID()}`,
        title: "T2",
      })
      .returning();
    const p = { galleryId: g.id, baseName: "x", driveHighresId: "d" };
    await db.insert(schema.photos).values(p);
    await expect(db.insert(schema.photos).values(p)).rejects.toThrow();
  });

  it("cascades gallery deletion to photos", async () => {
    const [g] = await db
      .insert(schema.galleries)
      .values({
        driveFolderId: `f-${crypto.randomUUID()}`,
        slug: `s-${crypto.randomUUID()}`,
        title: "T3",
      })
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

  async function mkGallery() {
    const [g] = await db
      .insert(schema.galleries)
      .values({
        driveFolderId: `f-${crypto.randomUUID()}`,
        slug: `s-${crypto.randomUUID()}`,
        title: "T",
      })
      .returning();
    return g;
  }

  it("rejects orphan FKs (photo/visitor/favorite without parents)", async () => {
    await expect(
      db
        .insert(schema.photos)
        .values({ galleryId: "nope", baseName: "x", driveHighresId: "d" }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.visitors).values({ galleryId: "nope", email: "a@b.c" }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.favorites).values({
        galleryId: "nope",
        visitorId: "nope",
        photoId: "nope",
      }),
    ).rejects.toThrow();
  });

  it("cascades gallery deletion to visitors and favorites", async () => {
    const g = await mkGallery();
    const [p] = await db
      .insert(schema.photos)
      .values({ galleryId: g.id, baseName: "x", driveHighresId: "d" })
      .returning();
    const [v] = await db
      .insert(schema.visitors)
      .values({ galleryId: g.id, email: "a@b.c" })
      .returning();
    await db
      .insert(schema.favorites)
      .values({ galleryId: g.id, visitorId: v.id, photoId: p.id });
    await db.delete(schema.galleries).where(eq(schema.galleries.id, g.id));
    expect(
      await db
        .select()
        .from(schema.visitors)
        .where(eq(schema.visitors.galleryId, g.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.favorites)
        .where(eq(schema.favorites.galleryId, g.id)),
    ).toHaveLength(0);
  });

  it("cascades photo / visitor deletion to favorites", async () => {
    const g = await mkGallery();
    const mk = async (base: string, email: string) => {
      const [p] = await db
        .insert(schema.photos)
        .values({ galleryId: g.id, baseName: base, driveHighresId: "d" })
        .returning();
      const [v] = await db
        .insert(schema.visitors)
        .values({ galleryId: g.id, email })
        .returning();
      await db
        .insert(schema.favorites)
        .values({ galleryId: g.id, visitorId: v.id, photoId: p.id });
      return { p, v };
    };
    const a = await mk("a", "a@b.c");
    const b = await mk("b", "b@b.c");
    await db.delete(schema.photos).where(eq(schema.photos.id, a.p.id));
    await db.delete(schema.visitors).where(eq(schema.visitors.id, b.v.id));
    expect(
      await db
        .select()
        .from(schema.favorites)
        .where(eq(schema.favorites.galleryId, g.id)),
    ).toHaveLength(0);
  });
});

describe("cover photo trigger", () => {
  it("deleting the cover photo nulls cover_photo_id", async () => {
    await applyD1Migrations(
      env.DB,
      (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
    );
    await env.DB.prepare(
      "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('cv-g','cv-f','cv-s','T')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES ('cv-p','cv-g','x','d')",
    ).run();
    await env.DB.prepare(
      "UPDATE galleries SET cover_photo_id='cv-p' WHERE id='cv-g'",
    ).run();
    await env.DB.prepare("DELETE FROM photos WHERE id='cv-p'").run();
    const row = await env.DB.prepare(
      "SELECT cover_photo_id FROM galleries WHERE id='cv-g'",
    ).first<{ cover_photo_id: string | null }>();
    expect(row?.cover_photo_id).toBeNull();
  });
});

describe("nowIso / photoVisible", () => {
  it("nowIso formats a given date at second precision, default is now", () => {
    expect(nowIso(new Date("2026-03-04T05:06:07.891Z"))).toBe(
      "2026-03-04T05:06:07Z",
    );
    expect(nowIso()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it("photoVisible hides photos in their sync grace period", async () => {
    await applyD1Migrations(
      env.DB,
      (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
    );
    const g = await seed();
    await db
      .update(schema.photos)
      .set({ missingSince: nowIso() })
      .where(eq(schema.photos.baseName, "b"));
    const rows = await db
      .select()
      .from(schema.photos)
      .where(and(eq(schema.photos.galleryId, g.id), photoVisible));
    expect(rows.map((r) => r.baseName)).toEqual(["a"]);
  });
});
