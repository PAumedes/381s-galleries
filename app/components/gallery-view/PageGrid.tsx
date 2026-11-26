import type { Ref } from "react";

import type { TFunction } from "../../i18n/t";
import { GAP_PX } from "../../lib/design";
import { Grid } from "../Grid";
import type { GalleryPhoto, OpenGallery } from "../types";

/** The photo grid (or the "no favourites yet" note on an empty favourites tab). */
export function PageGrid({
  gridRef,
  gallery,
  photos,
  emptyFavorites,
  t,
  protect,
  onOpen,
  onFavorite,
  onDownload,
  isFavorite,
}: {
  gridRef: Ref<HTMLElement>;
  gallery: OpenGallery;
  photos: readonly GalleryPhoto[];
  emptyFavorites: boolean;
  t: TFunction;
  protect: boolean;
  onOpen: (index: number) => void;
  onFavorite: (id: string) => void;
  onDownload?: (id: string) => void;
  isFavorite: (id: string) => boolean;
}) {
  const gap = GAP_PX[gallery.gridGap];
  return (
    <main
      ref={gridRef}
      id="grid"
      className="scroll-mt-12 px-1 py-1"
      style={gap > 6 ? { padding: gap } : undefined}
    >
      {emptyFavorites ? (
        <p className="text-body text-grey-600 py-section text-center">
          {t("favorites.empty")}
        </p>
      ) : (
        <Grid
          photos={photos}
          t={t}
          onOpen={onOpen}
          onFavorite={onFavorite}
          onDownload={onDownload}
          isFavorite={isFavorite}
          protect={protect}
          originalDownload={gallery.allowHighres}
          layout={gallery.gridStyle}
          gap={gap}
        />
      )}
    </main>
  );
}
