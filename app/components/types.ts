import type { GalleryMode, ImageVariant } from "../lib/constants";
import type { CoverLayout, GridGap, GridStyle, Palette } from "../lib/design";

export type GalleryPhoto = {
  id: string;
  width: number | null;
  height: number | null;
  set: string;
  /** Which downloadable sizes exist (high-res is always present). Downloads never fall back between sizes. */
  variants: { web: boolean; ig: boolean };
  /**
   * The original is a TIFF (T6.53d): browsers cannot show it, it is only
   * downloaded (high-res size, one file at a time, never in the ZIP).
   */
  tiff?: { name: string; bytes: number | null };
  /**
   * No image can be shown (a TIFF-only photo without web JPEG, or without
   * preview-wm in Prueba): the grid and the lightbox draw the placeholder
   * card "Vista previa no disponible". `width`/`height` are null then.
   */
  noPreview?: true;
  /** Opaque version token for this photo's image URLs (`?v=`); enables 1-year browser caching. */
  v?: string;
  /** Versioned albums (T6.53c): the version shown (>= 2, or a photo with a history); absent otherwise. */
  ver?: number;
  /** The shown version came with the newest round: the grid badge "Nuevo en esta ronda". */
  isNew?: true;
  /** Previews of every version a visitor may see, oldest first; only when there are at least two. */
  versions?: PhotoVersionInfo[];
};

/** One entry of a photo's history (previews only; never a Drive id). */
export type PhotoVersionInfo = {
  n: number;
  /** Delivery round number (null: the initial delivery or an unnamed round). */
  round: number | null;
  /** When the version first reached the album (UTC ISO). */
  at: string;
  /** Token of this version's image URLs (`?v=`). */
  v?: string;
};

export type ImgVariant = ImageVariant;

/** Builds an image URL; the admin preview swaps in `/admin/img` (see img-url.tsx). */
export type ImgUrlFn = (
  id: string,
  variant: ImgVariant,
  v?: string,
  /** A history entry of a versioned album: that version's preview (`?ver=`). */
  ver?: number,
) => string;

export const imgUrl: ImgUrlFn = (id, variant, v, ver) => {
  const query = [
    ver ? `ver=${ver}` : "",
    v ? `v=${encodeURIComponent(v)}` : "",
  ].filter(Boolean);
  return `/img/${encodeURIComponent(id)}/${variant}${query.length ? `?${query.join("&")}` : ""}`;
};

/** Client-safe gallery summary (no Drive ids, no PIN hash). */
export type OpenGallery = {
  slug: string;
  requireEmail: boolean;
  title: string;
  eventDate: string | null;
  coverPhotoId: string | null;
  /** Cover focal point: a point on the image, in percent of its width/height (u,v); null = automatic. */
  coverFocus?: { x: number; y: number } | null;
  /**
   * Optional mobile cover (narrow viewports), a visible photo of this gallery;
   * null/absent = the desktop cover with its own focal point.
   */
  coverPhotoIdMobile?: string | null;
  /** Focal point of the mobile cover (same meaning as `coverFocus`). */
  coverFocusMobile?: { x: number; y: number } | null;
  allowBulk: boolean;
  allowHighres: boolean;
  allowWeb: boolean;
  allowIg: boolean;
  /** 'proofing' (Prueba): watermarked images, no downloads, protected images. */
  mode: GalleryMode;
  palette: Palette;
  coverLayout: CoverLayout;
  gridStyle: GridStyle;
  gridGap: GridGap;
  sets: { name: string; count: number }[];
  /** Versioned albums (T6.53c): number of the newest delivery round shown ("Ronda N"); absent otherwise. */
  round?: number;
  /** Versioned albums (T6.53f): visitors can approve the shown version of a photo; absent otherwise. */
  approvals?: true;
};
