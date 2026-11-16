export type GalleryPhoto = {
  id: string;
  width: number | null;
  height: number | null;
  set: string;
};

export type ImgVariant = "thumb" | "view-sm" | "view-lg";

export const imgUrl = (id: string, variant: ImgVariant): string =>
  `/img/${encodeURIComponent(id)}/${variant}`;
