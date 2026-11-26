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
 * - In Prueba with no preview-wm at all there is no cover (null).
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
  /** false = no image can be shown (TIFF-only without a preview, T6.53d): never a cover. Absent = true. */
  hasPreview?: boolean;
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
  all: readonly CoverRow[],
  gallery: Pick<Row, "coverPhotoId" | "coverPhotoIdMobile" | "mode">,
): ResolvedCover {
  // A photo with nothing to show counts like a hidden one (T6.53d).
  const rows = all.filter((p) => p.hasPreview !== false);
  const proofing = gallery.mode === "proofing";
  const chosen = rows.find((p) => p.id === gallery.coverPhotoId);
  const base = chosen ?? rows[0];
  const firstWm = rows.find((p) => p.hasWm);
  const fallsToWm = proofing && !!base && !base.hasWm && !!firstWm;
  const mobileRow = rows.find((p) => p.id === gallery.coverPhotoIdMobile);
  const mobileNoWm = proofing && !!mobileRow && !mobileRow.hasWm;
  return {
    // Prueba with no preview-wm at all: nothing can be served, so no cover
    // (naming one would be a 404).
    cover:
      proofing && !firstWm ? null : fallsToWm ? firstWm.id : (base?.id ?? null),
    editCover: fallsToWm ? firstWm.id : (chosen?.id ?? null),
    mobile: mobileRow && !mobileNoWm ? mobileRow.id : null,
    mobileNoWm,
  };
}

const PHOTO_ORDER = "p.set_name, p.sort, p.base_name";

/** A preview-wm exists: NULL and '' both mean none (same as `!!driveWmId`). */
export const hasWmSql = (col = "p.drive_wm_id"): SQL<number> =>
  sql<number>`(NULLIF(${sql.raw(col)}, '') IS NOT NULL)`;

/** SQL twin of `hasPreview` for a TIFF-only photo (T6.53d): its TIFF id fills drive_highres_id. */
const TIFF_ONLY_NO_WEB = `COALESCE(p.drive_tiff_id = p.drive_highres_id, 0) AND NULLIF(p.drive_web_id, '') IS NULL`;

const SERVABLE = `p.missing_since IS NULL AND (galleries.mode = 'delivery' AND NOT (${TIFF_ONLY_NO_WEB}) OR galleries.mode <> 'delivery' AND NULLIF(p.drive_wm_id, '') IS NOT NULL)`;

function coverSql(ok: string): SQL<string | null> {
  const cond = sql.raw(ok);
  return sql<string | null>`COALESCE(
    (SELECT p.id FROM photos p WHERE p.id = galleries.cover_photo_id AND p.gallery_id = galleries.id AND ${cond}),
    (SELECT p.id FROM photos p WHERE p.gallery_id = galleries.id AND ${cond} ORDER BY ${sql.raw(PHOTO_ORDER)} LIMIT 1))`;
}

/**
 * SQL twin of `noPreview.length === photoCount` (T6.53d2): the album has
 * visible photos and every one is TIFF-only with nothing to show (no web JPEG
 * in delivery, no preview-wm in Prueba, as `hasPreview`). Such an album has no
 * cover; the client page lists it as a title-only tile.
 */
export const allTiffNoPreviewSql = (): SQL<number> => {
  const visible = `p.gallery_id = galleries.id AND p.missing_since IS NULL`;
  const noImage = `COALESCE(p.drive_tiff_id = p.drive_highres_id, 0) AND NULLIF(CASE WHEN galleries.mode = 'delivery' THEN p.drive_web_id ELSE p.drive_wm_id END, '') IS NULL`;
  return sql<number>`(EXISTS (SELECT 1 FROM photos p WHERE ${sql.raw(visible)}) AND NOT EXISTS (SELECT 1 FROM photos p WHERE ${sql.raw(visible)} AND NOT (${sql.raw(noImage)})))`;
};

/**
 * SQL twin of `resolveCover(...).cover` for list queries (`galleries` is the
 * outer table). Public home: in Prueba only photos with a preview-wm count, so
 * a gallery without any has no cover (null) and is left off the home.
 */
export const homeCoverIdSql = () => coverSql(SERVABLE);

/**
 * Admin list: the same rule as the home and the public page. A Prueba gallery
 * with no preview-wm at all has no cover (null), never a clean photo.
 */
export const listCoverIdSql = homeCoverIdSql;
