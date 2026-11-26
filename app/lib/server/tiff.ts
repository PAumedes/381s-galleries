/**
 * TIFF originals (T6.53d). Browsers cannot show a TIFF and the app never
 * converts images, so a TIFF is only ever STREAMED as a download (`/dl`); it is
 * never an image source (`/img`, R2 cache, warm).
 *
 * Model (migration 0024): `photos.drive_tiff_id` is the TIFF's Drive file id.
 * `drive_highres_id` is NOT NULL, so a TIFF-only photo (no JPEG high-res)
 * holds the TIFF's id in BOTH columns; a photo with a JPEG high-res and a TIFF
 * keeps the JPEG in `drive_highres_id`. Everything that turns the high-res
 * file into an image must go through `highresImageId`.
 */
import { safeFileBase } from "../text";

export const TIFF_MIME = "image/tiff";

interface Ids {
  driveHighresId: string;
  driveTiffId?: string | null;
}

/** The photo has a TIFF original (the high-res DOWNLOAD is that TIFF). */
export const hasTiffOriginal = (p: Pick<Ids, "driveTiffId">): boolean =>
  !!p.driveTiffId;

/** The TIFF is the only high-res file: there is no JPEG to serve as an image. */
export const isTiffOnly = (p: Ids): boolean =>
  !!p.driveTiffId && p.driveTiffId === p.driveHighresId;

/**
 * The high-res file a visitor's browser can show as an image, or null for a
 * TIFF-only photo (its previews, if any, are the web / thumb JPEGs).
 */
export const highresImageId = (p: Ids): string | null =>
  isTiffOnly(p) ? null : p.driveHighresId;

/**
 * Can a visitor see ANY image of this photo? A TIFF-only photo needs a web
 * JPEG (delivery) or a preview-wm (Prueba); every other photo is unchanged
 * (assumed to have one, as before TIFFs existed).
 */
export function hasPreview(
  p: Ids & { driveWebId?: string | null; driveWmId?: string | null },
  proofing: boolean,
): boolean {
  if (!isTiffOnly(p)) return true;
  return !!(proofing ? p.driveWmId : p.driveWebId);
}

/** `<name>.tif`: the name a TIFF download is saved as (sanitized stem). */
export const tiffFilename = (baseName: string): string =>
  `${safeFileBase(baseName)}.tif`;
