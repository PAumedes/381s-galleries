import { useEffect } from "react";

import type { GalleryPhoto, ImgUrlFn } from "../types";
import { srcSetOf } from "./srcset";

/**
 * Preload neighbours. Stale ones (we navigated on) are cancelled so rapid
 * navigation never piles up requests: at most the two current neighbours.
 */
export function usePreloadNeighbours(
  photos: readonly GalleryPhoto[],
  index: number,
  imgUrl: ImgUrlFn,
) {
  useEffect(() => {
    const inflight: HTMLImageElement[] = [];
    for (const p of [photos[index + 1], photos[index - 1]]) {
      if (!p) continue;
      const img = new Image();
      const done = () => {
        const at = inflight.indexOf(img);
        if (at >= 0) inflight.splice(at, 1);
      };
      img.onload = done;
      img.onerror = done;
      img.sizes = "(min-width: 768px) 92vw, 100vw";
      img.srcset = srcSetOf(imgUrl)(p.id, p.v);
      img.src = imgUrl(p.id, "view-sm", p.v);
      inflight.push(img);
    }
    return () => {
      for (const img of inflight) {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute?.("srcset");
        img.src = "";
      }
    };
  }, [photos, index, imgUrl]);
}
