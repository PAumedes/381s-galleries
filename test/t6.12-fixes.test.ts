import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { loadGalleryEdit } from "../app/lib/server/admin-galleries";
import { loadGallery } from "../app/lib/server/gallery";
import { allMessages } from "../app/i18n/dictionaries";

const db = getDb(env);
const G = "aaaaaaaa-0000-4000-8000-0000000fix12";
const P1 = "pppppppp-0000-4000-8000-0000000fix01"; // clean only
const P2 = "pppppppp-0000-4000-8000-0000000fix02"; // has preview-wm

beforeAll(async () => {
  await migrateDb();
});
async function seed(mode: "proofing" | "delivery") {
  await db.delete(schema.galleries);
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "fix12",
    title: "T",
    status: "published",
    mode,
  });
  await db.insert(schema.photos).values([
    { id: P1, galleryId: G, baseName: "A", driveHighresId: "H1", sort: 0 },
    {
      id: P2,
      galleryId: G,
      baseName: "B",
      driveHighresId: "H2",
      driveWmId: "W2",
      sort: 1,
    },
  ]);
}
const open = async () => {
  const r = await loadGallery(
    new Request("https://x.test/fix12"),
    "fix12",
    env,
  );
  if (r.data.state !== "open") throw new Error("not open");
  return r.data.gallery;
};
beforeEach(() => {});

describe("Prueba desktop cover without preview-wm", () => {
  it("public and editor both fall to the first photo with a preview-wm (auto and chosen)", async () => {
    await seed("proofing");
    expect((await open()).coverPhotoId).toBe(P2);
    expect((await loadGalleryEdit(env, G))!.gallery.coverPhotoId).toBe(P2);
    await db
      .update(schema.galleries)
      .set({ coverPhotoId: P1 })
      .where(eq(schema.galleries.id, G));
    expect((await open()).coverPhotoId).toBe(P2);
    expect((await loadGalleryEdit(env, G))!.gallery.coverPhotoId).toBe(P2);
  });
  it("Entrega is unchanged: the chosen / first photo stays the cover", async () => {
    await seed("delivery");
    expect((await open()).coverPhotoId).toBe(P1);
    expect((await loadGalleryEdit(env, G))!.gallery.coverPhotoId).toBeNull();
    await db
      .update(schema.galleries)
      .set({ coverPhotoId: P1 })
      .where(eq(schema.galleries.id, G));
    expect((await open()).coverPhotoId).toBe(P1);
    expect((await loadGalleryEdit(env, G))!.gallery.coverPhotoId).toBe(P1);
  });
});

describe("mobile cover without preview-wm", () => {
  it("Prueba: the editor flags it (warning) and drops it; Entrega keeps it", async () => {
    await seed("proofing");
    await db
      .update(schema.galleries)
      .set({ coverPhotoIdMobile: P1 })
      .where(eq(schema.galleries.id, G));
    const e = (await loadGalleryEdit(env, G))!.gallery;
    expect(e.coverPhotoIdMobile).toBeNull();
    expect((e as { mobileCoverNoWm?: boolean }).mobileCoverNoWm).toBe(true);
    await db
      .update(schema.galleries)
      .set({ mode: "delivery" })
      .where(eq(schema.galleries.id, G));
    const d = (await loadGalleryEdit(env, G))!.gallery;
    expect(d.coverPhotoIdMobile).toBe(P1);
    expect(
      (d as { mobileCoverNoWm?: boolean }).mobileCoverNoWm,
    ).toBeUndefined();
  });
  it("the warning exists in both dictionaries", () => {
    for (const l of ["es", "en"] as const) {
      const m = allMessages(l) as Record<string, string>;
      expect(m["admin.cover.mobileNoWm"]).toBeTruthy();
      expect(m["admin.design.leaveConfirm"]).toBeTruthy();
    }
  });
});
