import { useMemo } from "react";

import { useT } from "../../i18n/use-t";
import { GAP_PX, type GridGap, type GridStyle } from "../../lib/design";
import { Grid } from "../Grid";
import { adminImgUrl, ImgUrlProvider, type Versions } from "../img-url";
import type { GalleryPhoto } from "../types";
import type { PreviewPhoto } from "./LivePreview";

/** The real photo grid under the preview's cover, laid out for a `width` px viewport. */
export function PreviewGrid({
  photos,
  proofing,
  versions,
  gridStyle,
  gridGap,
  width,
}: {
  photos: readonly PreviewPhoto[];
  proofing: boolean;
  versions?: Versions;
  gridStyle: GridStyle;
  gridGap: GridGap;
  width: number;
}) {
  const t = useT();
  const imgUrl = useMemo(
    () => adminImgUrl(proofing, versions),
    [proofing, versions],
  );
  const gridPhotos = useMemo<GalleryPhoto[]>(
    () =>
      photos.map((p) => ({
        id: p.id,
        set: p.set,
        width: p.width ?? null,
        height: p.height ?? null,
        variants: { web: true, ig: true },
      })),
    [photos],
  );
  const gap = GAP_PX[gridGap];
  const pad = gap > 6 ? gap : 4;
  return (
    <div style={{ padding: pad }}>
      <ImgUrlProvider value={imgUrl}>
        <Grid
          photos={gridPhotos}
          t={t}
          onOpen={() => {}}
          layout={gridStyle}
          gap={gap}
          protect={proofing}
          initialWidth={width - 2 * pad}
        />
      </ImgUrlProvider>
    </div>
  );
}
