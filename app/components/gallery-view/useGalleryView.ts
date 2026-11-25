import { useCallback, useMemo, useState } from "react";

import { enabledSizes } from "../DownloadMenu";
import { useFavorites } from "../use-favorites";
import { useToast } from "../use-gallery-chrome";
import type { GalleryPhoto, OpenGallery } from "../types";
import { ALL, FAV, defaultTab } from "./tabs";

export type Sheet = { kind: "single"; id: string } | { kind: "bulk" } | null;

/**
 * State of the public gallery page: selected tab, open photo, download
 * sheet, favourites and the photos visible under the current tab.
 */
export function useGalleryView(
  gallery: OpenGallery,
  photos: readonly GalleryPhoto[],
  preview: boolean,
) {
  const [active, setActive] = useState<string>(defaultTab(gallery));
  const [open, setOpen] = useState<number | null>(null);
  // One toast slot: a newer message replaces the current one.
  const { toast, showToast } = useToast();
  const [sheet, setSheet] = useState<Sheet>(null);
  const favs = useFavorites(
    gallery.slug,
    gallery.requireEmail,
    () => showToast("favorites.error"),
    preview,
  );
  const favCount = useMemo(
    () => photos.filter((p) => favs.ids.has(p.id)).length,
    [photos, favs.ids],
  );
  const isFavorite = useCallback((id: string) => favs.ids.has(id), [favs.ids]);
  const visible = useMemo(
    () =>
      active === ALL
        ? photos
        : active === FAV
          ? photos.filter((p) => favs.ids.has(p.id))
          : photos.filter((p) => p.set === active),
    [photos, active, favs.ids],
  );
  const proofing = gallery.mode === "proofing";
  // Proofing never offers downloads, whatever the payload's allow_* say.
  const canDownload = !preview && !proofing && enabledSizes(gallery).length > 0;
  const select = (key: string) => {
    setActive(key);
    setOpen(null);
  };
  return {
    active,
    select,
    open,
    setOpen,
    toast,
    showToast,
    sheet,
    setSheet,
    favs,
    favCount,
    isFavorite,
    visible,
    proofing,
    canDownload,
    openSingle: canDownload
      ? (id: string) => setSheet({ kind: "single", id })
      : undefined,
  };
}
