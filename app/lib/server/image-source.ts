import { schema } from "../../db";
import { shortMac } from "./crypto";
import { IMAGE_VARIANTS } from "../constants";
import type { ImageVariant } from "../constants";

/** Which Drive file serves an image variant (PLAN 5.3 mode policy) and the version tokens that go with it. */
type Variant = ImageVariant;

/** Drive modifiedTime of the resolved source file, from photos.variant_versions ("" if unknown). */
function sourceVersion(photo: SourcePhoto, fileId: string): string {
  const ids = {
    highres: photo.driveHighresId,
    web: photo.driveWebId,
    ig: photo.driveIgId,
    thumb: photo.driveThumbId,
    wm: photo.driveWmId,
    thumbWm: photo.driveThumbWmId,
  } as const;
  const name = (Object.keys(ids) as (keyof typeof ids)[]).find(
    (k) => ids[k] === fileId,
  );
  if (!name || !photo.variantVersions) return "";
  try {
    const m: unknown = JSON.parse(photo.variantVersions);
    const t = (m as Record<string, unknown> | null)?.[name];
    return typeof t === "string" ? t : "";
  } catch {
    return "";
  }
}

export const IMMUTABLE_CACHE_CONTROL = "private, max-age=31536000, immutable";

type Photo = typeof schema.photos.$inferSelect;
/** The columns that decide which Drive file serves a variant. */
export type SourcePhoto = Pick<
  Photo,
  | "id"
  | "driveHighresId"
  | "driveWebId"
  | "driveIgId"
  | "driveThumbId"
  | "driveWmId"
  | "variantVersions"
> & {
  /** Optional watermarked 600px thumb (`thumb-wm`); absent on older rows. */
  driveThumbWmId?: string | null;
  /**
   * Which version of a versioned album's photo these columns are (T6.53c);
   * absent = v1. Only decides the R2 key (`cacheKey`).
   */
  version?: number;
};

/**
 * R2 key of one variant of a photo: `<id>/<variant>` for v1 (every photo of an
 * unversioned album, so nothing already cached is re-warmed), `<id>/v<N>/<variant>`
 * from v2 on.
 */
export function cacheKey(
  photo: Pick<SourcePhoto, "id" | "version">,
  variant: Variant,
): string {
  return `${cacheEntry(photo.id, photo.version ?? 1)}/${variant}`;
}

/**
 * The R2 prefix of one version of a photo (`<id>` for v1, `<id>/v<N>` from
 * v2): what the cleanup lists keep (pending deletes) and expand per variant.
 */
export const cacheEntry = (photoId: string, version: number): string =>
  version >= 2 ? `${photoId}/v${version}` : photoId;

export interface Source {
  fileId: string;
  /** true when the file is a watermarked one (proofing mode). */
  watermark: boolean;
  /** Drive modifiedTime of the file ("" if unknown: then it is never cached). */
  version: string;
}

/**
 * Which Drive file serves `variant` of `photo` (PLAN 5.3 mode policy and
 * fallbacks), or null when none exists (404). Shared by /img and cache warming.
 *
 * `proofing` (gallery mode Prueba): everything public is watermarked:
 * thumb = thumb-wm ?? preview-wm, view-* = preview-wm; never a clean file.
 * Delivery: thumb ?? web ?? high-res, web ?? high-res, high-res (never wm).
 */
export function resolveSource(
  photo: SourcePhoto,
  proofing: boolean,
  variant: Variant,
): Source | null {
  const fileId = proofing
    ? variant === "thumb"
      ? (photo.driveThumbWmId ?? photo.driveWmId)
      : photo.driveWmId
    : variant === "thumb"
      ? (photo.driveThumbId ?? photo.driveWebId ?? photo.driveHighresId)
      : variant === "view-sm"
        ? (photo.driveWebId ?? photo.driveHighresId)
        : photo.driveHighresId;
  if (!fileId) return null;
  return { fileId, watermark: proofing, version: sourceVersion(photo, fileId) };
}

/**
 * Short opaque token of what a photo's three image URLs currently resolve to
 * (file ids, watermark flags, modified times). HMAC with SESSION_SECRET, so
 * Drive ids are not recoverable from it. Used as `?v=` on image URLs.
 * Null when any served variant has an unknown version: such a token could not
 * change when the file does, so it must never enable immutable caching.
 */
export async function imageVersionToken(
  env: Pick<Env, "SESSION_SECRET">,
  photo: SourcePhoto,
  proofing: boolean,
): Promise<string | null> {
  const parts: string[] = [];
  for (const variant of IMAGE_VARIANTS) {
    const s = resolveSource(photo, proofing, variant);
    if (!s) {
      parts.push("-");
      continue;
    }
    if (!s.version) return null;
    parts.push(`${s.fileId}|${s.watermark ? 1 : 0}|${s.version}`);
  }
  if (parts.every((x) => x === "-")) return null;
  return shortMac(env.SESSION_SECRET, parts.join("\n"));
}

/**
 * Token of everything the ADMIN image routes can serve for `photo`: clean and
 * watermarked thumb / view-sm (file ids, watermark flags, modified times).
 * HMAC (SESSION_SECRET, own domain prefix), 16 hex chars, so Drive ids are not
 * recoverable. Used as `?v=` on `/admin/img` URLs: a matching one lets the
 * admin's browser keep the image privately; any re-export or file change
 * changes the token. Null when a served variant has an unknown version (such
 * a token could not change with the file), or when there is nothing to serve.
 */
export async function adminImageToken(
  env: Pick<Env, "SESSION_SECRET">,
  photo: SourcePhoto,
): Promise<string | null> {
  const parts: string[] = [];
  for (const proofing of [false, true]) {
    for (const variant of ["thumb", "view-sm"] as const) {
      const s = resolveSource(photo, proofing, variant);
      if (!s) {
        parts.push("-");
        continue;
      }
      if (!s.version) return null;
      parts.push(`${s.fileId}|${s.watermark ? 1 : 0}|${s.version}`);
    }
  }
  if (parts.every((x) => x === "-")) return null;
  return shortMac(env.SESSION_SECRET, `admin\n${parts.join("\n")}`);
}
