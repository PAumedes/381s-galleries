import { useCallback, useEffect, useRef, useState } from "react";

import type { GalleryPhoto, ImgUrlFn } from "../types";
import { PreloadCache, preloadOrder } from "./preload-cache";

/**
 * Warms the photos around `index`: two ahead in the direction of travel and
 * one behind, kept in a small cache (see `PreloadCache`). Returns `isReady`,
 * true for a photo that already finished loading, so the stage can show it at
 * once.
 */
export function usePreloadNeighbours(
  photos: readonly GalleryPhoto[],
  index: number,
  imgUrl: ImgUrlFn,
) {
  const [cache] = useState(() => new PreloadCache());
  const last = useRef({ index, dir: 1 as 1 | -1 });

  useEffect(() => {
    if (index !== last.current.index) {
      last.current = { index, dir: index > last.current.index ? 1 : -1 };
    }
    const wanted = preloadOrder(index, photos.length, last.current.dir)
      .map((i) => photos[i])
      .filter((p) => p && !p.noPreview);
    cache.warm(imgUrl, wanted);
  }, [cache, photos, index, imgUrl]);

  useEffect(() => () => cache.dispose(), [cache]);

  return useCallback(
    (photo: GalleryPhoto) => cache.isReady(imgUrl, photo),
    [cache, imgUrl],
  );
}
