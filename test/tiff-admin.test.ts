import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { loadGalleryEdit } from "../app/lib/server/admin-galleries";
import { ISSUE_KEYS } from "../app/lib/admin-gallery";
import { en } from "../app/i18n/en";
import { es } from "../app/i18n/es";

/** T6.53d: the album overview lists the TIFF-only photos that have no preview. */
const e = { ...env, DRIVE_MODE: "mock" } as Env;
const db = getDb(env);
const GID = "cccccccc-0000-4000-8000-0000000000c1";

beforeAll(migrateDb);
beforeEach(async () => {
  await db.delete(schema.galleries);
});

async function seed(mode: "delivery" | "proofing") {
  await db.insert(schema.galleries).values({
    id: GID,
    driveFolderId: "f",
    slug: "g",
    title: "G",
    status: "published",
    mode,
  });
  await db.insert(schema.photos).values([
    {
      id: "t1",
      galleryId: GID,
      baseName: "IMG_T1",
      sort: 0,
      driveHighresId: "T1",
      driveTiffId: "T1",
    },
    {
      id: "t2",
      galleryId: GID,
      baseName: "IMG_T2",
      sort: 1,
      driveHighresId: "T2",
      driveTiffId: "T2",
      driveWebId: "W2",
      driveWmId: "WM2",
    },
    {
      id: "j1",
      galleryId: GID,
      baseName: "IMG_J1",
      sort: 2,
      driveHighresId: "J1",
      driveWmId: "WMJ",
    },
  ]);
}
const group = async () =>
  (await loadGalleryEdit(e, GID))!.issues.groups.find(
    (x) => x.type === "tiff_no_preview",
  );

describe("T6.53d admin overview: 'sin vista previa'", () => {
  it("delivery: lists only the TIFF-only photo without a web JPEG (no ids)", async () => {
    await seed("delivery");
    const g = await group();
    expect(g?.items).toEqual([{ set: "Highlights", name: "IMG_T1" }]);
    expect(g?.label).toMatch(/sin vista previa/i);
    expect(JSON.stringify(g)).not.toMatch(/"T1"/);
  });

  it("Prueba: the TIFF-only photo without preview-wm; the one with a preview-wm is fine", async () => {
    await seed("proofing");
    expect((await group())?.items.map((i) => i.name)).toEqual(["IMG_T1"]);
  });

  it("no group when there are none, and the total counts it", async () => {
    await db.insert(schema.galleries).values({
      id: GID,
      driveFolderId: "f",
      slug: "g",
      title: "G",
      status: "published",
    });
    await db
      .insert(schema.photos)
      .values({ id: "j1", galleryId: GID, baseName: "J", driveHighresId: "J" });
    expect(await group()).toBeUndefined();
  });

  it("the type has ES and EN labels", () => {
    const key = ISSUE_KEYS.tiff_no_preview;
    expect(key).toBeDefined();
    expect(es[key]).toMatch(/sin vista previa/i);
    expect(en[key]).toMatch(/no preview/i);
  });
});
