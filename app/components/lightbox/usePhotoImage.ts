import { useEffect, useRef, useState } from "react";

import type { GalleryPhoto } from "../types";

export const withRetry = (url: string, n: number) =>
  n === 0 ? url : `${url}${url.includes("?") ? "&" : "?"}r=${n}`;

/**
 * Load/error/retry state of the current photo. Events from images of other
 * photos (out-of-order loads) are ignored.
 */
export function usePhotoImage(
  photos: readonly GalleryPhoto[],
  photo: GalleryPhoto,
) {
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  // Retry counter is per photo: a retry on one photo must not affect others.
  const [retryState, setRetryState] = useState<{ id: string; n: number }>({
    id: "",
    n: 0,
  });
  const currentId = useRef(photo.id);
  useEffect(() => {
    currentId.current = photo.id;
  });

  // An error belongs to one photo; navigating away forgets it so coming back
  // tries again.
  if (failedId !== null && failedId !== photo.id) setFailedId(null);

  const loaded = loadedId === photo.id;
  const failed = failedId === photo.id;
  // Keep the last loaded photo on screen while the new one loads.
  const behind =
    !loaded && !failed && loadedId !== null
      ? photos.find((p) => p.id === loadedId)
      : undefined;
  const retry = retryState.id === photo.id ? retryState.n : 0;

  return {
    loaded,
    failed,
    behind,
    retry,
    imgRef: (img: HTMLImageElement | null) => {
      if (
        img?.complete &&
        img.naturalWidth > 0 &&
        currentId.current === photo.id
      )
        setLoadedId(photo.id);
    },
    onLoad: () => {
      if (currentId.current === photo.id) setLoadedId(photo.id);
    },
    onError: () => {
      if (currentId.current === photo.id) setFailedId(photo.id);
    },
    onRetry: () => {
      setFailedId(null);
      setRetryState((r) => ({
        id: photo.id,
        n: r.id === photo.id ? r.n + 1 : 1,
      }));
    },
  };
}
