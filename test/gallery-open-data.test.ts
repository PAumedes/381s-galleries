import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { buildOpenData } from "../app/lib/server/gallery-open-data";
import { migrateDb, resetTables } from "./support/d1";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000b1";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables("gallery_views", "photos", "galleries");
});

async function addGallery(over: Partial<typeof schema.galleries.$inferInsert>) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "boda-ana",
    title: "Boda Ana",
    status: "published",
    ...over,
  });
}
async function addPhoto(
  n: number,
  over: Partial<typeof schema.photos.$inferInsert> = {},
) {
  await db.insert(schema.photos).values({
    id: `p${n}`,
    galleryId: G,
    baseName: `IMG_${n}`,
    driveHighresId: `hi${n}`,
    width: 3000,
    height: 2000,
    sort: n,
    ...over,
  });
}
async function setCover(id: string) {
  await db
    .update(schema.galleries)
    .set({ coverPhotoId: id })
    .where(eq(schema.galleries.id, G));
}
async function open() {
  const [g] = await db
    .select()
    .from(schema.galleries)
    .where(eq(schema.galleries.id, G));
  return buildOpenData(env, g);
}

describe("T6.47 buildOpenData: Open Graph cover", () => {
  it("Prueba: a chosen cover without preview-wm is not the og cover; the first photo with one is", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto(1);
    await addPhoto(2);
    await addPhoto(3, { driveWmId: "wm3" });
    await addPhoto(4, { driveWmId: "wm4" });
    await setCover("p2");
    const d = await open();
    expect(d.gallery.coverPhotoId).toBe("p3");
    expect(d.og).toEqual({ coverId: "p3", width: 1200, height: 800 });
  });
  it("Prueba: a chosen cover WITH preview-wm is the og cover even when an earlier photo has one", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto(1, { driveWmId: "wm1" });
    await addPhoto(2, { driveWmId: "wm2" });
    await setCover("p2");
    const d = await open();
    expect(d.og?.coverId).toBe("p2");
  });
  it("Prueba without any preview-wm: no og cover and no size", async () => {
    await addGallery({ mode: "proofing" });
    await addPhoto(1);
    await addPhoto(2);
    await setCover("p2");
    const d = await open();
    expect(d.gallery.coverPhotoId).toBeNull();
    expect(d.og).toEqual({ coverId: null, width: null, height: null });
  });
  it("Entrega: a chosen cover needs no preview-wm", async () => {
    await addGallery({});
    await addPhoto(1, { driveWmId: "wm1" });
    await addPhoto(2);
    await setCover("p2");
    expect((await open()).og?.coverId).toBe("p2");
  });
});

describe("T6.47 buildOpenData: Open Graph size rounds to the nearest pixel", () => {
  it("landscape 1001x667 -> 1200x800 (799.6 rounds up, not down)", async () => {
    await addGallery({});
    await addPhoto(1, { width: 1001, height: 667 });
    expect((await open()).og).toEqual({
      coverId: "p1",
      width: 1200,
      height: 800,
    });
  });
  it("portrait 667x1001 -> 800x1200", async () => {
    await addGallery({});
    await addPhoto(1, { width: 667, height: 1001 });
    expect((await open()).og).toEqual({
      coverId: "p1",
      width: 800,
      height: 1200,
    });
  });
  it("rounds 399.6 up to 400 (1000x333)", async () => {
    await addGallery({});
    await addPhoto(1, { width: 1000, height: 333 });
    expect((await open()).og).toEqual({
      coverId: "p1",
      width: 1200,
      height: 400,
    });
  });
  it("rounds down when the fraction is under .5 (1000x331 -> 397.2 -> 397)", async () => {
    await addGallery({});
    await addPhoto(1, { width: 1000, height: 331 });
    expect((await open()).og?.height).toBe(397);
  });
  it("a PIN gallery has no og at all", async () => {
    await addGallery({ pinHash: "x" });
    await addPhoto(1);
    expect((await open()).og).toBeNull();
  });
});
