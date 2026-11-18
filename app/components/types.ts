import type { CoverLayout, GridGap, GridStyle, Palette } from "../lib/design";

export type GalleryPhoto = {
  id: string;
  width: number | null;
  height: number | null;
  set: string;
  /** Which downloadable sizes exist (high-res is always present). Downloads never fall back between sizes. */
  variants: { web: boolean; ig: boolean };
  /** Opaque version token for this photo's image URLs (`?v=`); enables 1-year browser caching. */
  v?: string;
};

export type ImgVariant = "thumb" | "view-sm" | "view-lg";

/** Builds an image URL; the admin preview swaps in `/admin/img` (see img-url.tsx). */
export type ImgUrlFn = (id: string, variant: ImgVariant, v?: string) => string;

export const imgUrl: ImgUrlFn = (id, variant, v) =>
  `/img/${encodeURIComponent(id)}/${variant}${v ? `?v=${encodeURIComponent(v)}` : ""}`;

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
  mode: "proofing" | "delivery";
  palette: Palette;
  coverLayout: CoverLayout;
  gridStyle: GridStyle;
  gridGap: GridGap;
  sets: { name: string; count: number }[];
};
