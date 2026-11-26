import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import {
  listGalleries,
  loadGalleryEdit,
} from "../app/lib/server/admin-galleries";
import { buildOpenData } from "../app/lib/server/gallery";
import { loadHome } from "../app/lib/server/home";

/**
 * T6.53d: a photo with no image to show (TIFF-only without web JPEG, or
 * without preview-wm in Prueba) is never a cover, in the four cover views.
 */
const e = { ...env, DRIVE_MODE: "mock" } as Env;
const db = getDb(env);
const GID = "cccccccc-0000-4000-8000-0000000000a1";
const pid = (n: string) => `dddddddd-0000-4000-8000-0000000000${n}`;
const T1 = pid("t1"); // TIFF-only, nothing else
const T2 = pid("t2"); // TIFF-only + web
const P3 = pid("p3"); // plain JPEG

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
});

const row = (
  id: string,
  sort: number,
  over: Partial<typeof schema.photos.$inferInsert>,
) => ({
  id,
  galleryId: GID,
  baseName: `IMG_${id.slice(-2)}`,
  sort,
  driveHighresId: `hr-${id}`,
  width: 3000,
  height: 2000,
  ...over,
});
const tiff = (id: string) => ({
  driveHighresId: `tif-${id}`,
  driveTiffId: `tif-${id}`,
});

async function seed(
  mode: "delivery" | "proofing",
  photos: (typeof schema.photos.$inferInsert)[],
  cover: { desktop?: string; mobile?: string } = {},
) {
  await db.insert(schema.galleries).values({
    id: GID,
    driveFolderId: "f1",
    slug: "g1",
    title: "G1",
    status: "published",
    showOnHome: true,
    mode,
  });
  await db.insert(schema.photos).values(photos);
  await db
    .update(schema.galleries)
    .set({
      coverPhotoId: cover.desktop ?? null,
      coverPhotoIdMobile: cover.mobile ?? null,
    })
    .where(eq(schema.galleries.id, GID));
}

async function covers() {
  const [g] = await db
    .select()
    .from(schema.galleries)
    .where(eq(schema.galleries.id, GID));
  const open = (await buildOpenData(e, g!)).gallery;
  const edit = (await loadGalleryEdit(e, GID))!.gallery;
  const home = (await loadHome(e)).items.find((i) => i.slug === "g1");
  const list = (await listGalleries(e, "all")).find((r) => r.id === GID)!;
  return {
    public: open.coverPhotoId,
    mobile: open.coverPhotoIdMobile,
    edit: edit.coverPhotoId,
    home: home?.cover.id ?? null,
    list: list.coverPhotoId,
  };
}

describe("T6.53d covers skip photos with nothing to show (all four views agree)", () => {
  it("delivery: first photo is TIFF-only without web: the first photo with an image is the cover", async () => {
    await seed("delivery", [
      row(T1, 0, tiff(T1)),
      row(T2, 1, { ...tiff(T2), driveWebId: "web-t2" }),
      row(P3, 2, {}),
    ]);
    expect(await covers()).toMatchObject({
      public: T2,
      home: T2,
      list: T2,
    });
  });

  it("a chosen TIFF-only cover falls back like a hidden one; a chosen mobile one is not served", async () => {
    await seed("delivery", [row(T1, 0, tiff(T1)), row(P3, 1, {})], {
      desktop: T1,
      mobile: T1,
    });
    expect(await covers()).toEqual({
      public: P3,
      mobile: null,
      edit: null,
      home: P3,
      list: P3,
    });
  });

  it("no photo with an image at all: no cover anywhere and the album leaves the home", async () => {
    await seed("delivery", [row(T1, 0, tiff(T1))]);
    expect(await covers()).toEqual({
      public: null,
      mobile: null,
      edit: null,
      home: null,
      list: null,
    });
  });

  it("Prueba: a TIFF-only photo WITH preview-wm is a normal cover candidate; without it, never", async () => {
    await seed("proofing", [
      row(T1, 0, tiff(T1)),
      row(T2, 1, { ...tiff(T2), driveWmId: "wm-t2" }),
    ]);
    expect(await covers()).toMatchObject({ public: T2, home: T2, list: T2 });
  });

  it("a photo with a TIFF and a JPEG high-res is an ordinary cover candidate", async () => {
    await seed("delivery", [
      row(T1, 0, { driveTiffId: "tif-x" }), // JPEG high-res stays in drive_highres_id
    ]);
    expect(await covers()).toMatchObject({ public: T1, home: T1, list: T1 });
  });
});

describe("T6.53d focal point of a mobile cover with no preview", () => {
  it("saveFocus refuses it (the cover is not served)", async () => {
    const { saveFocus } =
      await import("../app/lib/server/admin-galleries/actions/focus");
    await seed("delivery", [row(T1, 0, tiff(T1)), row(P3, 1, {})]);
    await db
      .update(schema.galleries)
      .set({ coverPhotoIdMobile: T1 })
      .where(eq(schema.galleries.id, GID));
    const [g] = await db.select().from(schema.galleries);
    const f = new FormData();
    f.set("device", "mobile");
    f.set("focusX", "10");
    f.set("focusY", "10");
    const r = await saveFocus(env, g, f, ((k: string) => k) as never);
    expect(r.ok).toBe(false);
  });
});
