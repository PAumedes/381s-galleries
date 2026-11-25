import { srcSetOf } from "./lightbox/srcset";
import type { ImgUrlFn } from "./types";

/**
 * The files of a full-bleed cover: `src` is the 1200 px view-sm (what a
 * phone needs: 412 px x 2.6 DPR is 1071 px) and `srcSet` lets wide screens
 * take the 2048 px view-lg. Always asking for view-lg made every phone
 * download the big file for the very first image of the page.
 */
export function coverFiles(imgUrl: ImgUrlFn, id: string, v?: string) {
  const src = imgUrl(id, "view-sm", v);
  // The admin preview has no 2048 px file: one URL, no srcset.
  return imgUrl(id, "view-lg", v) === src
    ? { src, srcSet: undefined }
    : { src, srcSet: srcSetOf(imgUrl)(id, v) };
}

/** Photo width / height, or null when the size is unknown. */
export const aspectOf = (p?: {
  width?: number | null;
  height?: number | null;
}) => (p?.width && p.height ? p.width / p.height : null);
