import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { schema } from "../../db";

/**
 * The cover-photo rule, in one place. Used by the public gallery payload, the
 * admin editor loader, the public home and the admin list.
 *
 * - A chosen cover counts only while it is a VISIBLE photo of the gallery;
 *   else the first visible photo (gallery order) is used.
 * - In Prueba (proofing) only a photo with a preview-wm can be served, so a
 *   cover without one falls to the first photo that has one.
 * - The optional mobile cover follows the same visibility rule; in Prueba one
 *   without a preview-wm is not served (the desktop cover is used instead).
 */

export type Device = "desktop" | "mobile";

/** Gallery columns that hold each device's cover photo and focal point. */
export const DEVICE_FIELDS = {
  desktop: {
    photo: "coverPhotoId",
    fx: "coverFocusX",
    fy: "coverFocusY",
  },
  mobile: {
    photo: "coverPhotoIdMobile",
    fx: "coverFocusMobileX",
    fy: "coverFocusMobileY",
  },
} as const satisfies Record<
  Device,
  { photo: keyof Row; fx: keyof Row; fy: keyof Row }
>;

type Row = typeof schema.galleries.$inferSelect;

export type Focus = { x: number; y: number };

/** Focal point (percent on the image) from its two nullable columns. */
export const focusOf = (x: number | null, y: number | null): Focus | null =>
  x !== null && y !== null ? { x, y } : null;

/** A visible photo of the gallery, in gallery order. */
export interface CoverRow {
  id: string;
  /** Has a preview-wm file (the only thing Prueba can serve). */
  hasWm: boolean;
}

export interface ResolvedCover {
  /** Cover the public page serves (null = gallery without photos). */
  cover: string | null;
  /**
   * Cover the editor shows as "chosen": the chosen visible photo, or the
   * Prueba fallback when that is what the public page serves; null = automatic.
   */
  editCover: string | null;
  /** Mobile cover served to the public (null = use the desktop cover). */
  mobile: string | null;
  /** Prueba: the chosen mobile cover has no preview-wm and is not served. */
  mobileNoWm: boolean;
}

export function resolveCover(
  rows: readonly CoverRow[],
  gallery: Pick<Row, "coverPhotoId" | "coverPhotoIdMobile" | "mode">,
): ResolvedCover {
  const proofing = gallery.mode === "proofing";
  const chosen = rows.find((p) => p.id === gallery.coverPhotoId);
  const base = chosen ?? rows[0];
  const firstWm = rows.find((p) => p.hasWm);
  const fallsToWm = proofing && !!base && !base.hasWm && !!firstWm;
  const mobileRow = rows.find((p) => p.id === gallery.coverPhotoIdMobile);
  const mobileNoWm = proofing && !!mobileRow && !mobileRow.hasWm;
  return {
    cover: fallsToWm ? firstWm.id : (base?.id ?? null),
    editCover: fallsToWm ? firstWm.id : (chosen?.id ?? null),
    mobile: mobileRow && !mobileNoWm ? mobileRow.id : null,
    mobileNoWm,
  };
}

const PHOTO_ORDER = "p.set_name, p.sort, p.base_name";

/**
 * SQL twin of `resolveCover(...).cover` for list queries (`galleries` is the
 * outer table). `proofingAware` = in Prueba only photos with a preview-wm
 * count (the public home); without it every visible photo does.
 */
export function coverIdSql(proofingAware: boolean): SQL<string | null> {
  const ok = sql.raw(
    proofingAware
      ? "p.missing_since IS NULL AND (galleries.mode = 'delivery' OR p.drive_wm_id IS NOT NULL)"
      : "p.missing_since IS NULL",
  );
  return sql<string | null>`COALESCE(
    (SELECT p.id FROM photos p WHERE p.id = galleries.cover_photo_id AND p.gallery_id = galleries.id AND ${ok}),
    (SELECT p.id FROM photos p WHERE p.gallery_id = galleries.id AND ${ok} ORDER BY ${sql.raw(PHOTO_ORDER)} LIMIT 1))`;
}
