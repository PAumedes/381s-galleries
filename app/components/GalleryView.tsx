import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useLang, useT } from "../i18n/use-t";
import { useStudioName } from "../lib/use-studio-name";
import { AddToHomeHint } from "./AddToHomeHint";
import { DownloadMenu, enabledSizes } from "./DownloadMenu";
import { EmailGate } from "./EmailGate";
import { Grid } from "./Grid";
import { GAP_PX, isDarkPalette } from "../lib/design";
import { formatEventDate } from "../lib/event-date";
import { SiteFooter } from "./SiteFooter";
import { LanguageToggle } from "./LanguageToggle";
import { Lightbox } from "./Lightbox";
import { Logo } from "./Logo";
import { CoverHero } from "./CoverHero";
import { coverFiles } from "./cover-files";
import { useFavorites } from "./use-favorites";
import { useImgUrl } from "./img-url";
import { SetTabs } from "./SetTabs";
import { Toast, TopBarActions } from "./GalleryTopBar";
import {
  reducedMotion,
  useHideOnScroll,
  useTabEdges,
  useToast,
} from "./use-gallery-chrome";
import type { GalleryPhoto, OpenGallery } from "./types";

const ALL = "\u0000all";
const FAV = "\u0000fav";

const aspectOf = (p: GalleryPhoto | undefined) =>
  p?.width && p.height ? p.width / p.height : null;

export function GalleryView({
  gallery,
  photos,
  downloadSlot,
  preview = false,
}: {
  gallery: OpenGallery;
  photos: readonly GalleryPhoto[];
  /** Right side of the top bar; Phase 3 puts the download menu here. */
  downloadSlot?: ReactNode;
  /**
   * Admin preview: same page, but read-only and offline: favourites stay in
   * memory, no downloads, no share or install prompts, no API calls.
   */
  preview?: boolean;
}) {
  const t = useT();
  const imgUrl = useImgUrl();
  const lang = useLang();
  const studio = useStudioName();
  const multi = gallery.sets.length > 1;
  const [active, setActive] = useState<string>(
    multi ? ALL : (gallery.sets[0]?.name ?? ALL),
  );
  const [open, setOpen] = useState<number | null>(null);
  // One toast slot: a newer message replaces the current one.
  const { toast, showToast } = useToast();
  const [sheet, setSheet] = useState<
    { kind: "single"; id: string } | { kind: "bulk" } | null
  >(null);
  const tabsRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLElement>(null);
  const coverRef = useRef<HTMLElement>(null);

  const hidden = useHideOnScroll(coverRef);
  const { edges, updateEdges } = useTabEdges(tabsRef, active);

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
  const toggleFav = favs.toggle;

  const visible = useMemo(
    () =>
      active === ALL
        ? photos
        : active === FAV
          ? photos.filter((p) => favs.ids.has(p.id))
          : photos.filter((p) => p.set === active),
    [photos, active, favs.ids],
  );

  const scrollToGrid = useCallback(() => {
    gridRef.current?.scrollIntoView?.({
      behavior: reducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  const proofing = gallery.mode === "proofing";
  // Proofing never offers downloads, whatever the payload's allow_* say.
  const canDownload = !preview && !proofing && enabledSizes(gallery).length > 0;
  const openSingle = canDownload
    ? (id: string) => setSheet({ kind: "single", id })
    : undefined;
  const sheetPhoto =
    sheet?.kind === "single"
      ? photos.find((p) => p.id === sheet.id)
      : undefined;

  const date = formatEventDate(gallery.eventDate, lang);
  const coverPhoto = photos.find((p) => p.id === gallery.coverPhotoId);
  const coverId = coverPhoto?.id ?? gallery.coverPhotoId;
  const cover = coverId ? coverFiles(imgUrl, coverId, coverPhoto?.v) : null;
  const mobilePhoto = gallery.coverPhotoIdMobile
    ? photos.find((p) => p.id === gallery.coverPhotoIdMobile)
    : undefined;
  const tabs = [
    ...(multi
      ? [
          { key: ALL, label: t("gallery.all") },
          ...gallery.sets.map((s) => ({ key: s.name, label: s.name })),
        ]
      : []),
    ...(favCount > 0 || active === FAV
      ? [{ key: FAV, label: t("favorites.tab", { n: favCount }) }]
      : []),
  ];

  return (
    <div
      data-page=""
      data-theme={gallery.palette}
      className="bg-paper text-ink min-h-dvh"
    >
      <CoverHero
        headerRef={coverRef}
        title={gallery.title}
        date={date}
        studio={studio}
        src={cover?.src ?? null}
        srcSet={cover?.srcSet}
        proofing={proofing}
        focus={gallery.coverFocus ?? null}
        aspect={aspectOf(coverPhoto)}
        mobile={
          mobilePhoto
            ? {
                ...coverFiles(imgUrl, mobilePhoto.id, mobilePhoto.v),
                focus: gallery.coverFocusMobile ?? null,
                aspect: aspectOf(mobilePhoto),
              }
            : null
        }
        scrollLabel={t("gallery.view")}
        onScroll={scrollToGrid}
        layout={gallery.coverLayout}
        palette={gallery.palette}
      />

      <nav
        className={`bg-paper/80 duration-base ease-out-soft sticky top-0 z-(--z-topbar) grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4 backdrop-blur transition-transform ${
          hidden ? "-translate-y-full" : "translate-y-0"
        }`}
      >
        <Logo
          variant={isDarkPalette(gallery.palette) ? "light" : "dark"}
          className="hidden h-7 min-w-0 justify-self-start overflow-hidden sm:block"
        />
        <SetTabs
          tabs={tabs}
          active={active}
          tabsRef={tabsRef}
          edges={edges}
          onScroll={updateEdges}
          onSelect={(key) => {
            setActive(key);
            setOpen(null);
          }}
        />
        <TopBarActions
          downloadSlot={downloadSlot}
          showBulk={canDownload && gallery.allowBulk}
          onBulk={() => setSheet({ kind: "bulk" })}
          favOn={active === FAV}
          hasFavs={favCount > 0}
          onToggleFavs={() => {
            setActive(
              active === FAV
                ? multi
                  ? ALL
                  : (gallery.sets[0]?.name ?? ALL)
                : FAV,
            );
            setOpen(null);
          }}
          shareTitle={preview ? null : gallery.title}
          onCopied={() => showToast("gallery.linkCopied")}
        />
      </nav>

      <main
        ref={gridRef}
        id="grid"
        className="scroll-mt-12 px-1 py-1"
        style={
          GAP_PX[gallery.gridGap] > 6
            ? { padding: GAP_PX[gallery.gridGap] }
            : undefined
        }
      >
        {active === FAV && visible.length === 0 ? (
          <p className="text-body text-grey-600 py-section text-center">
            {t("favorites.empty")}
          </p>
        ) : (
          <Grid
            photos={visible}
            t={t}
            onOpen={setOpen}
            onFavorite={toggleFav}
            onDownload={openSingle}
            isFavorite={isFavorite}
            protect={proofing}
            layout={gallery.gridStyle}
            gap={GAP_PX[gallery.gridGap]}
          />
        )}
      </main>

      <footer className="flex flex-col items-center gap-4 px-6 py-section">
        <p className="text-micro-label text-grey-600 uppercase">
          {t("footer.copyright", { year: new Date().getFullYear(), studio })}
        </p>
        <SiteFooter />
        <LanguageToggle className="text-grey-600" />
      </footer>

      {!preview && <AddToHomeHint slug={gallery.slug} gridRef={gridRef} />}

      {toast && <Toast key={toast.n} messageKey={toast.key} />}

      {open !== null && (
        <Lightbox
          photos={visible}
          index={open}
          t={t}
          onClose={() => setOpen(null)}
          onIndexChange={setOpen}
          onFavorite={toggleFav}
          onDownload={openSingle}
          isFavorite={isFavorite}
          protect={proofing}
        />
      )}

      {sheet && (sheet.kind === "bulk" || sheetPhoto) && (
        <DownloadMenu
          gallery={gallery}
          t={t}
          ensure={favs.ensure}
          onClose={() => setSheet(null)}
          onError={() => showToast("download.error")}
          mode={
            sheet.kind === "bulk"
              ? {
                  kind: "bulk",
                  photos,
                  activeSet: active === ALL || active === FAV ? null : active,
                  favoriteIds: favs.ids,
                }
              : { kind: "single", photo: sheetPhoto! }
          }
        />
      )}

      {favs.gateOpen && (
        <EmailGate t={t} onSubmit={favs.submitGate} onClose={favs.closeGate} />
      )}
    </div>
  );
}
