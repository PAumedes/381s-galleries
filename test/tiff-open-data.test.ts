import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { buildOpenData } from "../app/lib/server/gallery-open-data";

/** T6.53d: the public payload of photos with a TIFF original. */
const db = getDb(env);
const GID = "cccccccc-0000-4000-8000-0000000000b1";
const VV = JSON.stringify({ highres: "h", web: "w", thumb: "t", wm: "m" });

beforeAll(migrateDb);
beforeEach(async () => {
  await db.delete(schema.galleries);
});

const photo = (
  id: string,
  sort: number,
  over: Partial<typeof schema.photos.$inferInsert>,
) => ({
  id,
  galleryId: GID,
  baseName: `IMG_${id}`,
  sort,
  driveHighresId: `HI-${id}`,
  variantVersions: VV,
  width: 3000,
  height: 2000,
  ...over,
});
const tiff = (id: string, bytes = 312_000_000) => ({
  driveHighresId: `TIF-${id}`,
  driveTiffId: `TIF-${id}`,
  highresBytes: bytes,
  width: null,
  height: null,
});

async function open(
  mode: "delivery" | "proofing",
  ps: ReturnType<typeof photo>[],
) {
  await db.insert(schema.galleries).values({
    id: GID,
    driveFolderId: "f",
    slug: "g",
    title: "G",
    status: "published",
    mode,
  });
  await db.insert(schema.photos).values(ps);
  const [g] = await db
    .select()
    .from(schema.galleries)
    .where(eq(schema.galleries.id, GID));
  return buildOpenData(env, g);
}
const byId = (d: Awaited<ReturnType<typeof open>>, id: string) =>
  d.photos.find((p) => p.id === id)!;

describe("T6.53d public payload", () => {
  it("TIFF-only without web: noPreview + tiff {name, bytes}, no dimensions, no image token, no Drive ids", async () => {
    const d = await open("delivery", [
      photo("a", 0, tiff("a")),
      photo("b", 1, { driveWebId: "WEB-b", driveThumbId: "TH-b" }),
    ]);
    const a = byId(d, "a");
    expect(a).toMatchObject({
      id: "a",
      width: null,
      height: null,
      noPreview: true,
      tiff: { name: "IMG_a.tif", bytes: 312_000_000 },
    });
    expect(a.v).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/TIF-|HI-|WEB-|TH-/);
    const b = byId(d, "b");
    expect(b.noPreview).toBeUndefined();
    expect(b.tiff).toBeUndefined();
    expect(Object.keys(b)).not.toContain("noPreview");
  });

  it("TIFF + web JPEG: previews as usual (token, size) and the tiff note only", async () => {
    const d = await open("delivery", [
      photo("a", 0, {
        ...tiff("a"),
        driveWebId: "WEB-a",
        driveThumbId: "TH-a",
        width: 2048,
        height: 1365,
      }),
    ]);
    const a = byId(d, "a");
    expect(a.noPreview).toBeUndefined();
    expect(a.tiff).toEqual({ name: "IMG_a.tif", bytes: 312_000_000 });
    expect(a.v).toEqual(expect.any(String));
    expect(a.width).toBe(2048);
  });

  it("JPEG high-res + TIFF: previews from the JPEG, tiff note present", async () => {
    const d = await open("delivery", [
      photo("a", 0, { driveTiffId: "TIF-a", highresBytes: 9 }),
    ]);
    expect(byId(d, "a").noPreview).toBeUndefined();
    expect(byId(d, "a").tiff).toEqual({ name: "IMG_a.tif", bytes: 9 });
  });

  it("a photo without a TIFF has neither field (payload unchanged)", async () => {
    const d = await open("delivery", [photo("a", 0, {})]);
    expect(Object.keys(byId(d, "a")).sort()).toEqual(
      ["height", "id", "set", "v", "variants", "width"].sort(),
    );
  });

  it("Prueba: no preview-wm = placeholder; with preview-wm = normal; downloads stay off", async () => {
    const d = await open("proofing", [
      photo("a", 0, { ...tiff("a"), driveWebId: "WEB-a" }),
      photo("b", 1, {
        ...tiff("b"),
        driveWmId: "WM-b",
        width: 2048,
        height: 1365,
      }),
    ]);
    expect(byId(d, "a").noPreview).toBe(true);
    expect(byId(d, "b").noPreview).toBeUndefined();
    expect(byId(d, "b").v).toEqual(expect.any(String));
    expect(d.gallery).toMatchObject({ allowHighres: false, allowBulk: false });
  });

  it("the filename is sanitized (no path separators or control characters)", async () => {
    const d = await open("delivery", [
      photo("a", 0, { ...tiff("a"), baseName: 'x/..\\y"\u0007z' }),
    ]);
    expect(byId(d, "a").tiff?.name).toBe('x..y"z.tif');
  });

  it("og cover never names a placeholder photo", async () => {
    const d = await open("delivery", [photo("a", 0, tiff("a"))]);
    expect(d.og).toEqual({ coverId: null, width: null, height: null });
  });
});
