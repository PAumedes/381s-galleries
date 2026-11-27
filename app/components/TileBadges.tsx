import type { TFunction } from "../i18n/t";
import type { GalleryPhoto } from "./types";

const BADGE =
  "pointer-events-none absolute bg-black/60 px-2 py-1 text-micro uppercase text-white";

/**
 * Small labels on a grid tile (never interactive): "new in this round"
 * (T6.53c, top left) and "approved in vN" (T6.53f, bottom left; only when the
 * approved version is the one shown).
 */
export function TileBadges({
  photo,
  index,
  t,
  approved = null,
}: {
  photo: GalleryPhoto;
  index: number;
  t: TFunction;
  approved?: number | null;
}) {
  return (
    <>
      {photo.isNew && (
        <span data-testid={`new-${index}`} className={`${BADGE} top-1 left-1`}>
          {t("grid.newInRound")}
        </span>
      )}
      {approved !== null && (
        <span
          data-testid={`approved-${index}`}
          className={`${BADGE} bottom-1 left-1`}
        >
          {t("approvals.approved", { n: approved })}
        </span>
      )}
    </>
  );
}
