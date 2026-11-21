import type { GalleryPhoto, ImgUrlFn } from "../types";

export const srcSetOf = (imgUrl: ImgUrlFn) => (id: string, v?: string) => {
  const sm = imgUrl(id, "view-sm", v);
  const lg = imgUrl(id, "view-lg", v);
  // The admin preview has no 2048 px variant: a single candidate then.
  return lg === sm ? `${sm} 1200w` : `${sm} 1200w, ${lg} 2048w`;
};

export const SIZES = "(min-width: 768px) 92vw, 100vw";

/**
 * The src/srcset/sizes of a lightbox photo. The stage and the preloader both
 * use this, so a preload warms exactly the entry the stage will request.
 */
export const photoImgProps = (imgUrl: ImgUrlFn, p: GalleryPhoto) => ({
  src: imgUrl(p.id, "view-sm", p.v),
  srcSet: srcSetOf(imgUrl)(p.id, p.v),
  sizes: SIZES,
});

/**
 * The grid thumbnail of a photo: already in the browser cache (the grid loaded
 * it), so it stands in while the full photo loads. Proofing galleries get the
 * watermarked one from the same URL (server) or `thumb-wm` (admin preview).
 */
export const thumbSrc = (imgUrl: ImgUrlFn, p: GalleryPhoto) =>
  imgUrl(p.id, "thumb", p.v);
