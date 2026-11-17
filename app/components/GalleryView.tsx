import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { TKey } from "../i18n/t";
import { useLang, useT } from "../i18n/use-t";
import { useStudioName } from "../lib/use-studio-name";
import { AddToHomeHint } from "./AddToHomeHint";
import { DownloadMenu, enabledSizes } from "./DownloadMenu";
import { EmailGate } from "./EmailGate";
import { Grid } from "./Grid";
import { formatEventDate } from "../lib/event-date";
import { SiteFooter } from "./SiteFooter";
import { LanguageToggle } from "./LanguageToggle";
import { Lightbox } from "./Lightbox";
import { Logo } from "./Logo";
import { ChevronDown, Download, Heart, HeartFilled, Share } from "./icons";
import { useFavorites } from "./use-favorites";
import { imgUrl, type GalleryPhoto, type OpenGallery } from "./types";

const ALL = "\u0000all";
const FAV = "\u0000fav";

const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function GalleryView({
  gallery,
  photos,
  downloadSlot,
}: {
  gallery: OpenGallery;
  photos: readonly GalleryPhoto[];
  /** Right side of the top bar; Phase 3 puts the download menu here. */
  downloadSlot?: ReactNode;
}) {
  const t = useT();
  const lang = useLang();
  const studio = useStudioName();
  const multi = gallery.sets.length > 1;
  const [active, setActive] = useState<string>(
    multi ? ALL : (gallery.sets[0]?.name ?? ALL),
  );
  const [open, setOpen] = useState<number | null>(null);
  // One toast slot: a newer message replaces the current one.
  const [toast, setToast] = useState<{ key: TKey; n: number } | null>(null);
  const showToast = useCallback(
    (key: TKey) => setToast((cur) => ({ key, n: (cur?.n ?? 0) + 1 })),
    [],
  );
  const [sheet, setSheet] = useState<
    { kind: "single"; id: string } | { kind: "bulk" } | null
  >(null);
  const [hidden, setHidden] = useState(false);
  const [edges, setEdges] = useState({ start: false, end: false });
  const tabsRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLElement>(null);
  const coverRef = useRef<HTMLElement>(null);

  const favs = useFavorites(gallery.slug, gallery.requireEmail, () =>
    showToast("favorites.error"),
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

  // Hide the top bar on scroll down, show it on scroll up.
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const past = y > (coverRef.current?.offsetHeight ?? 0);
      if (Math.abs(y - last) > 6) {
        setHidden(past && y > last);
        last = y;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Fade mask on whichever edge of the tab row has more tabs beyond it.
  const updateEdges = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);

  // Keep the active tab in view (horizontal only: never scrolls the page).
  useEffect(() => {
    const list = tabsRef.current;
    const tab = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (list && tab && typeof list.scrollTo === "function")
      list.scrollTo({
        left: tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2,
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    updateEdges();
  }, [active, updateEdges]);

  useEffect(() => {
    window.addEventListener("resize", updateEdges);
    return () => window.removeEventListener("resize", updateEdges);
  }, [updateEdges]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(
      () => setToast(null),
      toast.key === "gallery.linkCopied" ? 2000 : 3000,
    );
    return () => clearTimeout(id);
  }, [toast]);

  const scrollToGrid = useCallback(() => {
    gridRef.current?.scrollIntoView?.({
      behavior: reducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  const share = useCallback(async () => {
    const url = new URL(window.location.href);
    const link = `${url.origin}${url.pathname}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast("gallery.linkCopied");
    } catch {
      /* clipboard unavailable: nothing to confirm */
    }
  }, [showToast]);

  const canDownload = enabledSizes(gallery).length > 0;
  const openSingle = canDownload
    ? (id: string) => setSheet({ kind: "single", id })
    : undefined;
  const sheetPhoto =
    sheet?.kind === "single"
      ? photos.find((p) => p.id === sheet.id)
      : undefined;

  const date = formatEventDate(gallery.eventDate, lang);
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
      data-theme={gallery.theme === "dark" ? "dark" : undefined}
      className="bg-paper text-ink min-h-dvh"
    >
      <header
        ref={coverRef}
        className="on-dark relative flex h-dvh min-h-96 w-full flex-col justify-between overflow-hidden bg-night text-white"
      >
        {gallery.coverPhotoId && (
          <img
            src={imgUrl(
              gallery.coverPhotoId,
              "view-lg",
              photos.find((p) => p.id === gallery.coverPhotoId)?.v,
            )}
            alt=""
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-black/20"
        />
        <div className="relative p-6">
          <Logo variant="light" className="h-12" />
        </div>
        <div className="relative flex flex-col items-center gap-6 px-6 pb-10 text-center">
          <h1 className="text-display font-light uppercase">{gallery.title}</h1>
          {date && (
            <p className="text-body -mt-3 font-light tracking-wide">{date}</p>
          )}
          <p className="text-micro-label uppercase">{studio}</p>
          <button
            type="button"
            onClick={scrollToGrid}
            className="text-micro-label duration-base ease-out-soft flex min-h-11 flex-col items-center gap-1 uppercase text-white/80 transition-colors hover:text-white"
          >
            {t("gallery.view")}
            <ChevronDown className="size-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav
        className={`bg-paper/80 duration-base ease-out-soft sticky top-0 z-(--z-topbar) grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 sm:grid-cols-[1fr_auto_1fr] sm:gap-4 backdrop-blur transition-transform ${
          hidden ? "-translate-y-full" : "translate-y-0"
        }`}
      >
        <Logo
          variant={gallery.theme === "dark" ? "light" : "dark"}
          className="hidden h-7 justify-self-start sm:block"
        />
        {tabs.length === 0 ? (
          <div aria-hidden="true" />
        ) : (
          <nav
            ref={tabsRef}
            aria-label={t("gallery.sets")}
            onScroll={updateEdges}
            style={{
              maskImage: `linear-gradient(to right, ${edges.start ? "transparent, #000 1.5rem" : "#000, #000 0"}, ${edges.end ? "#000 calc(100% - 1.5rem), transparent" : "#000 100%, #000"})`,
            }}
            className="flex min-w-0 snap-x snap-proximity items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-current={active === tab.key ? "true" : undefined}
                onClick={() => {
                  setActive(tab.key);
                  setOpen(null);
                }}
                className={`text-micro-label duration-base ease-out-soft min-h-11 shrink-0 snap-center border-b px-3 uppercase whitespace-nowrap transition-colors ${
                  active === tab.key
                    ? "border-ink text-ink"
                    : "text-grey-600 hover:text-ink border-transparent"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        )}
        <div className="flex items-center justify-self-end">
          {downloadSlot}
          {canDownload && gallery.allowBulk && (
            <button
              type="button"
              onClick={() => setSheet({ kind: "bulk" })}
              aria-label={t("download.title")}
              className="text-grey-600 hover:text-ink flex size-11 items-center justify-center"
            >
              <Download className="size-5" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setActive(
                active === FAV
                  ? multi
                    ? ALL
                    : (gallery.sets[0]?.name ?? ALL)
                  : FAV,
              );
              setOpen(null);
            }}
            aria-label={t("favorites.title")}
            aria-pressed={active === FAV}
            className="text-grey-600 hover:text-ink flex size-11 items-center justify-center"
          >
            {active === FAV || favCount > 0 ? (
              <HeartFilled className="size-5" aria-hidden="true" />
            ) : (
              <Heart className="size-5" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={share}
            aria-label={t("gallery.share")}
            className="text-grey-600 hover:text-ink flex size-11 items-center justify-center"
          >
            <Share className="size-5" aria-hidden="true" />
          </button>
        </div>
      </nav>

      <main ref={gridRef} id="grid" className="scroll-mt-12 px-1 py-1">
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

      <AddToHomeHint slug={gallery.slug} gridRef={gridRef} />

      {toast && (
        <p
          key={toast.n}
          role="status"
          className="text-micro-label bg-ink text-paper fixed bottom-6 left-1/2 z-(--z-toast) -translate-x-1/2 px-5 py-3 uppercase"
        >
          {t(toast.key)}
        </p>
      )}

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
