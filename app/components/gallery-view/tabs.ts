import type { TFunction } from "../../i18n/t";
import type { SetTab } from "../SetTabs";
import type { OpenGallery } from "../types";

/** Tab keys that are not set names (NUL cannot appear in a folder name). */
export const ALL = "\u0000all";
export const FAV = "\u0000fav";

/** The tab selected when the visitor leaves the favourites view. */
export const defaultTab = (gallery: OpenGallery) =>
  gallery.sets.length > 1 ? ALL : (gallery.sets[0]?.name ?? ALL);

/** "All" + one per set (multi-set galleries) + favourites once there is one. */
export function buildTabs(
  gallery: OpenGallery,
  active: string,
  favCount: number,
  t: TFunction,
): SetTab[] {
  return [
    ...(gallery.sets.length > 1
      ? [
          { key: ALL, label: t("gallery.all") },
          ...gallery.sets.map((s) => ({ key: s.name, label: s.name })),
        ]
      : []),
    ...(favCount > 0 || active === FAV
      ? [{ key: FAV, label: t("favorites.tab", { n: favCount }) }]
      : []),
  ];
}
