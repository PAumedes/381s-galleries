export type GalleryPhoto = {
  id: string;
  width: number | null;
  height: number | null;
  set: string;
  /** Which downloadable sizes exist (high-res is always present). Downloads never fall back between sizes. */
  variants: { web: boolean; ig: boolean };
};

export type ImgVariant = "thumb" | "view-sm" | "view-lg";

export const imgUrl = (id: string, variant: ImgVariant): string =>
  `/img/${encodeURIComponent(id)}/${variant}`;

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
