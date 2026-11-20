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
  isReady: (photo: GalleryPhoto) => boolean = () => false,
) {
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
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

  const retry = retryState.id === photo.id ? retryState.n : 0;
  // A neighbour the preloader already loaded is on screen from the first
  // frame (it comes from the memory cache). It is not a real load of this
  // <img>: a retry (new URL) must start hidden again.
  const preloaded = retry === 0 && isReady(photo);
  const loaded = loadedId === photo.id || preloaded;
  const failed = failedId === photo.id;
  // Keep the last photo shown on screen while the new one loads.
  if (loaded && shownId !== photo.id) setShownId(photo.id);
  const behind =
    !loaded && !failed && shownId !== null && shownId !== photo.id
      ? photos.find((p) => p.id === shownId)
      : undefined;

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
