import type { TFunction } from "../i18n/t";
import type { GalleryPhoto } from "./types";

/** Small labels on a grid tile (never interactive): "new in this round" (T6.53c). */
export function TileBadges({
  photo,
  index,
  t,
}: {
  photo: GalleryPhoto;
  index: number;
  t: TFunction;
}) {
  return (
    <>
      {photo.isNew && (
        <span
          data-testid={`new-${index}`}
          className="pointer-events-none absolute top-1 left-1 bg-black/60 px-2 py-1 text-micro uppercase text-white"
        >
          {t("grid.newInRound")}
        </span>
      )}
    </>
  );
}
