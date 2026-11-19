import { useEffect } from "react";

import { coverSrc } from "../LivePreview";
import type { PendingCover } from "../optimistic-cover";
import type { PreviewState } from "./types";

/** A cover just chosen: start fetching what the previews and picker will ask for. */
export function useCoverPrefetch(
  pendingCover: PendingCover | null,
  { proofing, versions }: Pick<PreviewState, "proofing" | "versions">,
) {
  useEffect(() => {
    if (!pendingCover?.photoId) return;
    const v = versions[pendingCover.photoId];
    for (const src of [
      coverSrc(pendingCover.photoId, proofing, v),
      coverSrc(pendingCover.photoId, false, v),
    ])
      new Image().src = src;
  }, [pendingCover?.photoId, proofing, versions]);
}
