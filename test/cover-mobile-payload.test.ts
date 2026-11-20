import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { loadGalleryEdit } from "../app/lib/server/admin-galleries";
import { loadGallery } from "../app/lib/server/gallery";

const db = getDb(env);
const G = "aaaaaaaa-0000-4000-8000-00000000t627";
const P1 = "pppppppp-0000-4000-8000-00000000t627";
const P2 = "pppppppp-0000-4000-8000-00000000t628";

beforeAll(migrateDb);

async function seed(mode: "delivery" | "proofing") {
  await db.delete(schema.galleries);
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "cover-t627",
    title: "T",
    status: "published",
    mode,
  });
  await db.insert(schema.photos).values(
    [P1, P2].map((id, sort) => ({
      id,
      galleryId: G,
      baseName: id,
      driveHighresId: "HI" + sort,
      driveWmId: "WM" + sort,
      width: 3000,
      height: 2000,
      sort,
    })),
  );
  await db
    .update(schema.galleries)
    .set({
      coverPhotoId: P1,
      coverFocusX: 20,
      coverFocusY: 30,
      coverPhotoIdMobile: P2,
      coverFocusMobileX: 60,
      coverFocusMobileY: 70,
    })
    .where(eq(schema.galleries.id, G));
}

describe("T6.27 published gallery payload carries both covers", () => {
  for (const mode of ["delivery", "proofing"] as const) {
    describe(mode, () => {
      beforeEach(() => seed(mode));
      it("public payload: desktop and mobile cover + focus, mobile photo listed", async () => {
        const r = await loadGallery(
          new Request("https://x.test/cover-t627"),
          "cover-t627",
          env,
        );
        if (r.data.state !== "open") throw new Error("not open");
        expect(r.data.gallery.coverPhotoId).toBe(P1);
        expect(r.data.gallery.coverFocus).toEqual({ x: 20, y: 30 });
        expect(r.data.gallery.coverPhotoIdMobile).toBe(P2);
        expect(r.data.gallery.coverFocusMobile).toEqual({ x: 60, y: 70 });
        expect(r.data.photos.map((p) => p.id)).toContain(P2);
      });
      it("admin editor agrees with the public payload", async () => {
        const edit = await loadGalleryEdit(env, G);
        expect(edit!.gallery.coverPhotoIdMobile).toBe(P2);
        expect(edit!.gallery.coverFocusMobile).toEqual({ x: 60, y: 70 });
      });
    });
  }
});
