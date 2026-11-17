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

export const imgUrl = (id: string, variant: ImgVariant, v?: string): string =>
  `/img/${encodeURIComponent(id)}/${variant}${v ? `?v=${encodeURIComponent(v)}` : ""}`;

/** Client-safe gallery summary (no Drive ids, no PIN hash). */
export type OpenGallery = {
  slug: string;
  requireEmail: boolean;
  title: string;
  eventDate: string | null;
  clientName: string | null;
  coverPhotoId: string | null;
  allowBulk: boolean;
  allowHighres: boolean;
  allowWeb: boolean;
  allowIg: boolean;
  theme: "light" | "dark";
  sets: { name: string; count: number }[];
};
