import { DOWNLOAD_SIZES, type DownloadSize } from "../constants";
import { safeFileBase, wellFormed } from "../text";
import { hasTiffOriginal, tiffFilename } from "./tiff";
import type { schema } from "../../db";
import type { AccessEnv, GalleryRow } from "./access";
import type { RateRule } from "./rate-limit";

/** Limits, token claims and file rules shared by the token/bulk endpoints and `/dl/:token`. */
export const DL_TOKEN_TTL_SECONDS = 10 * 60;
export const DL_WINDOW_MS = 10 * 60 * 1000;
/** Token/bulk requests per ip+gallery per window (a big bulk run needs one per 50 files plus refreshes). */
export const DL_MAX_PER_WINDOW = 300;
export const DL_MAX_IDS = 50;
/** `/dl` hits per ip+gallery per window (zips with retries and refreshes). */
export const DL_GET_MAX_PER_WINDOW = 3000;
/** Uses of one download token (retries, ranges, resumes). */
export const DL_TOKEN_MAX_USES = 20;
/** Token/bulk requests per ip+gallery. */
export const DL_RATE: RateRule = {
  scope: "dl",
  max: DL_MAX_PER_WINDOW,
  windowMs: DL_WINDOW_MS,
};
/** `/dl` hits per ip+gallery. */
export const DL_GET_RATE: RateRule = {
  scope: "dlget",
  max: DL_GET_MAX_PER_WINDOW,
  windowMs: DL_WINDOW_MS,
};
/** Uses of one token (window = the token's remaining TTL, set per hit). */
export const DL_TOKEN_RATE: RateRule = {
  scope: "dlj",
  max: DL_TOKEN_MAX_USES,
  windowMs: DL_TOKEN_TTL_SECONDS * 1000,
};
export type DlVariant = DownloadSize;
export type PhotoRow = typeof schema.photos.$inferSelect;
export type DlEnv = AccessEnv & Pick<Env, "DOWNLOAD_SECRET">;

export interface DlToken {
  t: "dl";
  jti: string;
  g: string;
  p: string;
  v: DlVariant;
  vid: string;
  pf: string;
  b?: string;
}

export const isVariant = (v: unknown): v is DlVariant =>
  typeof v === "string" && (DOWNLOAD_SIZES as readonly string[]).includes(v);

export function variantAllowed(g: GalleryRow, v: DlVariant): boolean {
  // Proofing (Prueba): nothing is downloadable, whatever the allow_* flags say.
  if (g.mode === "proofing") return false;
  return v === "highres"
    ? g.allowHighres
    : v === "web"
      ? g.allowWeb
      : g.allowIg;
}

/**
 * The download is a TIFF (T6.53d): the high-res size of a photo with a TIFF
 * original. Streamed one file at a time: never zipped, never cached.
 */
export const isTiffDownload = (
  p: Pick<PhotoRow, "driveTiffId">,
  v: DlVariant,
): boolean => v === "highres" && hasTiffOriginal(p);

export function fileIdFor(p: PhotoRow, v: DlVariant): string | null {
  return (
    (v === "highres"
      ? p.driveTiffId || p.driveHighresId
      : v === "web"
        ? p.driveWebId
        : p.driveIgId) || null
  );
}

/** Download file name: no path separators / control chars (unicode kept); a TIFF original is `.tif`. */
export function downloadFilename(
  baseName: string,
  v: DlVariant,
  tiff = false,
): string {
  if (tiff && v === "highres") return tiffFilename(baseName);
  return `${safeFileBase(baseName)}${v === "highres" ? "" : `-${v}`}.jpg`;
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const star = encodeURIComponent(wellFormed(filename)).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}
