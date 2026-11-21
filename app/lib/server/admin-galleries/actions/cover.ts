import { and, eq } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import { DEVICE_FIELDS } from "../../cover";
import { warmCoverPhoto } from "../../warm";
import { deviceOf, done, fail } from "./shared";
import type { GalleryActionDeps, GalleryRow } from "./shared";

export async function saveCover(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
  deps?: GalleryActionDeps,
) {
  const intent = "cover";
  const device = deviceOf(f);
  const raw = f.get("photoId");
  if (!device || (raw !== null && typeof raw !== "string"))
    return fail(intent, t("admin.msg.invalidRequest"));
  const photoId = raw ?? "";
  const db = getDb(env);
  const cols = DEVICE_FIELDS[device];
  const clear = { [cols.photo]: null, [cols.fx]: null, [cols.fy]: null };
  if (photoId === "") {
    await db
      .update(schema.galleries)
      .set(clear)
      .where(eq(schema.galleries.id, g.id));
    return done(
      intent,
      device === "mobile"
        ? t("admin.msg.coverMobileCleared")
        : t("admin.msg.coverAuto"),
    );
  }
  const [p] = await db
    .select({ id: schema.photos.id })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.id, photoId),
        eq(schema.photos.galleryId, g.id),
        photoVisible,
      ),
    );
  if (!p) return fail(intent, t("admin.msg.coverNotInGallery"));
  // A new photo resets that device's focal point to the center.
  await db
    .update(schema.galleries)
    .set({ ...clear, [cols.photo]: p.id })
    .where(eq(schema.galleries.id, g.id));
  // The new cover is about to be looked at (here and by clients): fill R2 for
  // that photo in the background so nobody waits for a cold Drive fetch.
  if (deps?.ctx && deps.drive)
    deps.ctx.waitUntil(
      warmCoverPhoto(env, deps.drive, g.id, p.id).catch(() => {
        // Best effort: the first view just streams from Drive as before.
      }),
    );
  return done(
    intent,
    device === "mobile"
      ? t("admin.msg.coverMobileSaved")
      : t("admin.msg.coverSaved"),
  );
}
