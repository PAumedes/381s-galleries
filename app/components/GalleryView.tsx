import { useCallback, useRef } from "react";
import type { ReactNode, RefObject } from "react";

import { useT } from "../i18n/use-t";
import { AddToHomeHint } from "./AddToHomeHint";
import { reducedMotion, useHideOnScroll } from "./use-gallery-chrome";
import { PageCover } from "./gallery-view/PageCover";
import { PageFooter } from "./gallery-view/PageFooter";
import { PageGrid } from "./gallery-view/PageGrid";
import { PageNav } from "./gallery-view/PageNav";
import { PageOverlays } from "./gallery-view/PageOverlays";
import { FAV, buildTabs, defaultTab } from "./gallery-view/tabs";
import { useGalleryView } from "./gallery-view/useGalleryView";
import type { GalleryPhoto, OpenGallery } from "./types";

type GalleryViewProps = {
  gallery: OpenGallery;
  photos: readonly GalleryPhoto[];
  /** Right side of the top bar; Phase 3 puts the download menu here. */
  downloadSlot?: ReactNode;
  /**
   * Admin preview: same page, but read-only and offline: favourites stay in
   * memory, no downloads, no share or install prompts, no API calls.
   */
  preview?: boolean;
};

export function GalleryView({
  gallery,
  photos,
  downloadSlot,
  preview = false,
}: GalleryViewProps) {
  const t = useT();
  const view = useGalleryView(gallery, photos, preview);
  const { active, favCount, favs } = view;
  const gridRef = useRef<HTMLElement>(null);
  const coverRef = useRef<HTMLElement>(null);
  const hidden = useHideOnScroll(coverRef);
  const scrollToGrid = useScrollTo(gridRef);

  return (
    <div
      data-page=""
      data-theme={gallery.palette}
      className="bg-paper text-ink min-h-dvh"
    >
      <PageCover
        gallery={gallery}
        photos={photos}
        headerRef={coverRef}
        onScroll={scrollToGrid}
      />
      <PageNav
        gallery={gallery}
        hidden={hidden}
        tabs={buildTabs(gallery, active, favCount, t)}
        active={active}
        favCount={favCount}
        showBulk={view.canDownload && gallery.allowBulk}
        downloadSlot={downloadSlot}
        shareTitle={preview ? null : gallery.title}
        onSelect={view.select}
        onToggleFavs={() =>
          view.select(active === FAV ? defaultTab(gallery) : FAV)
        }
        onBulk={() => view.setSheet({ kind: "bulk" })}
        onCopied={() => view.showToast("gallery.linkCopied")}
      />
      <PageGrid
        gridRef={gridRef}
        gallery={gallery}
        photos={view.visible}
        emptyFavorites={active === FAV && view.visible.length === 0}
        t={t}
        protect={view.proofing}
        onOpen={view.setOpen}
        onFavorite={favs.toggle}
        onDownload={view.openSingle}
        isFavorite={view.isFavorite}
      />
      <PageFooter />
      {!preview && <AddToHomeHint slug={gallery.slug} gridRef={gridRef} />}
      <PageOverlays gallery={gallery} photos={photos} view={view} t={t} />
    </div>
  );
}

/** Smooth-scroll (unless reduced motion) to the top of `ref`'s element. */
function useScrollTo(ref: RefObject<HTMLElement | null>) {
  return useCallback(() => {
    ref.current?.scrollIntoView?.({
      behavior: reducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  }, [ref]);
}
