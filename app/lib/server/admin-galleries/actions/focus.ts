import { and, eq } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import { DEVICE_FIELDS } from "../../cover";
import { deviceOf, done, fail, str } from "./shared";
import type { GalleryRow } from "./shared";

// A plain decimal (optional sign/exponent); no hex, no Infinity/NaN words.
const FOCUS_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Cover focal point = a point ON THE IMAGE as percentages (u,v) of its width
 * and height. Both empty = automatic (null); else any finite number 0-100,
 * rounded to one decimal.
 */
export async function saveFocus(
  env: Env,
  g: GalleryRow,
  form: FormData,
  t: TFunction,
) {
  const intent = "focus";
  const device = deviceOf(form);
  if (!device) return fail(intent, t("admin.msg.invalidRequest"));
  if (device === "mobile") {
    // A mobile focal point only means something for a (visible) mobile cover.
    const [p] = g.coverPhotoIdMobile
      ? await getDb(env)
          .select({ id: schema.photos.id })
          .from(schema.photos)
          .where(
            and(
              eq(schema.photos.id, g.coverPhotoIdMobile),
              eq(schema.photos.galleryId, g.id),
              photoVisible,
            ),
          )
      : [];
    if (!p) return fail(intent, t("admin.msg.focusNoMobileCover"));
  }
  const rx = str(form, "focusX").trim();
  const ry = str(form, "focusY").trim();
  let x: number | null = null;
  let y: number | null = null;
  if (rx !== "" || ry !== "") {
    x = FOCUS_RE.test(rx) ? Number(rx) : Number.NaN;
    y = FOCUS_RE.test(ry) ? Number(ry) : Number.NaN;
    if (
      !(Number.isFinite(x) && Number.isFinite(y)) ||
      !(x >= 0 && x <= 100 && y >= 0 && y <= 100)
    )
      return fail(intent, t("admin.msg.focusRange"));
    x = round1(x);
    y = round1(y);
  }
  await getDb(env)
    .update(schema.galleries)
    .set({ [DEVICE_FIELDS[device].fx]: x, [DEVICE_FIELDS[device].fy]: y })
    .where(eq(schema.galleries.id, g.id));
  return done(
    intent,
    x === null ? t("admin.msg.focusCentered") : t("admin.msg.focusSaved"),
  );
}
