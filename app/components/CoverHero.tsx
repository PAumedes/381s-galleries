import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Ref } from "react";

import { coverObjectPosition, type Focus } from "../lib/cover-focus";
import { isDarkPalette, type CoverLayout, type Palette } from "../lib/design";

import { Logo } from "./Logo";
import { ChevronDown } from "./icons";

/**
 * Viewports that get the optional mobile cover (a `<picture>` source, so the
 * browser downloads only the one it shows).
 */
export const MOBILE_COVER_MEDIA = "(max-width: 767px)";

export type CoverImage = {
  src: string;
  focus: Focus | null;
  aspect: number | null;
};

/**
 * The gallery cover (full-bleed photo, title, date, studio, scroll cue).
 * Used by the public gallery and by the admin live preview, so they cannot
 * drift. `embedded` is the preview flavour: it fills its box instead of the
 * viewport and is inert (no heading level, no real button).
 */
export function CoverHero({
  title,
  date,
  studio,
  src,
  proofing,
  focus,
  aspect = null,
  scrollLabel,
  onScroll,
  embedded = false,
  headerRef,
  layout = "completa",
  palette = "claro",
  mobile = null,
  device,
}: {
  title: string;
  date: string | null;
  studio: string;
  /** Cover image URL (null = no photo). */
  src: string | null;
  proofing: boolean;
  /** Focal point on the image (percent of its width/height); null = centered. */
  focus: Focus | null;
  /** Photo width / height; needed to place the focal point (null = centered). */
  aspect?: number | null;
  scrollLabel: string;
  onScroll?: () => void;
  embedded?: boolean;
  headerRef?: Ref<HTMLElement>;
  /** Cover layout (T6.5). Default: Completa (full-bleed photo). */
  layout?: CoverLayout;
  /** Palette: only the layouts that sit on the page background (not on the photo) use it. */
  palette?: Palette;
  /** Optional mobile cover (own photo and focal point) for narrow viewports. */
  mobile?: CoverImage | null;
  /**
   * Admin previews: render as this device (the preview frame is not the
   * viewport). Absent = decide by the viewport (`MOBILE_COVER_MEDIA`).
   */
  device?: "desktop" | "mobile";
}) {
  const Title = embedded ? "p" : "h1";
  const imgRef = useRef<HTMLImageElement>(null);
  const [narrow, setNarrow] = useState(false);
  const hasMobile = !!mobile;
  useEffect(() => {
    if (device || !hasMobile || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MOBILE_COVER_MEDIA);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, [device, hasMobile]);
  const active =
    mobile && (device ? device === "mobile" : narrow) ? mobile : null;
  const onMobile = active !== null;
  const shownSrc = device && active ? active.src : src;
  const shownFocus = active ? active.focus : focus;
  const shownAspect = active ? active.aspect : aspect;
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  // Measure the real frame (the image fills it; layout size is unaffected by
  // the preview's scale transform) so object-position can be computed per
  // axis. SSR / before the first measure: centered.
  useLayoutEffect(() => {
    const node = imgRef.current;
    if (!node) return;
    const measure = () => {
      const w = node.clientWidth;
      const h = node.clientHeight;
      setFrame((f) => (f && f.w === w && f.h === h ? f : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [shownSrc, layout]);
  const pos = coverObjectPosition(shownFocus, shownAspect, frame);
  const shield = proofing && src && (
    <span
      data-testid="cover-shield"
      aria-hidden="true"
      className="absolute inset-0"
      onContextMenu={(e) => e.preventDefault()}
    />
  );
  const img = shownSrc && (
    <img
      ref={imgRef}
      data-cover-img=""
      data-cover-device={onMobile ? "mobile" : "desktop"}
      src={shownSrc}
      alt=""
      fetchPriority={embedded ? undefined : "high"}
      draggable={false}
      style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
      className="absolute inset-0 size-full object-cover"
    />
  );
  // Public page with a mobile cover: the browser picks the file by viewport.
  const photo =
    img && mobile && !device ? (
      <picture>
        <source media={MOBILE_COVER_MEDIA} srcSet={mobile.src} />
        {img}
      </picture>
    ) : (
      img
    );
  const protect = proofing && layout !== "minima" ? " img-protect" : "";
  const noMenu = proofing
    ? (e: React.MouseEvent) => e.preventDefault()
    : undefined;
  const logo = (
    <Logo
      variant={isDarkPalette(palette) ? "light" : "dark"}
      className="h-12"
    />
  );
  const cue = (
    <ScrollCue
      embedded={embedded}
      label={scrollLabel}
      onScroll={onScroll}
      className="text-grey-600 hover:text-ink"
    />
  );
  const titleBlock = (
    <>
      <Title className="text-display font-light uppercase">{title}</Title>
      {date && (
        <p className="text-body -mt-3 font-light tracking-wide">{date}</p>
      )}
      <p className="text-micro-label uppercase">{studio}</p>
    </>
  );
  const box = embedded ? "h-full" : "h-dvh min-h-96";

  if (layout === "dividida") {
    return (
      <header
        ref={headerRef}
        data-cover-layout="dividida"
        className={`@container bg-paper text-ink relative w-full overflow-hidden ${box}${protect}`}
        onContextMenu={noMenu}
      >
        <div className="flex size-full flex-col @3xl:flex-row">
          <div
            data-cover-pane="image"
            className="bg-night relative min-h-0 flex-3 overflow-hidden"
          >
            {photo}
            {shield}
          </div>
          <div
            data-cover-pane="text"
            className="bg-paper text-ink flex min-h-0 flex-2 flex-col items-center justify-between gap-6 px-6 py-6 text-center"
          >
            {logo}
            <div className="flex flex-col items-center gap-6">{titleBlock}</div>
            {cue}
          </div>
        </div>
      </header>
    );
  }

  if (layout === "centrada") {
    return (
      <header
        ref={headerRef}
        data-cover-layout="centrada"
        className={`bg-paper text-ink relative flex w-full flex-col items-center gap-6 px-6 py-6 text-center sm:px-16 ${box}${protect}`}
        onContextMenu={noMenu}
      >
        {logo}
        <div
          data-cover-frame=""
          className="bg-grey-100 relative min-h-0 w-full max-w-6xl flex-1 overflow-hidden"
        >
          {photo}
          {shield}
        </div>
        <div className="flex flex-col items-center gap-4">
          {titleBlock}
          {cue}
        </div>
      </header>
    );
  }

  if (layout === "minima") {
    return (
      <header
        ref={headerRef}
        data-cover-layout="minima"
        className={`bg-paper text-ink relative flex w-full flex-col items-center gap-6 px-6 pt-8 pb-12 text-center ${embedded ? "h-full justify-center" : ""}`}
      >
        {logo}
        {titleBlock}
      </header>
    );
  }

  return (
    <header
      ref={headerRef}
      data-cover-layout="completa"
      className={`on-dark relative flex w-full flex-col justify-between overflow-hidden bg-night text-white ${box}${protect}`}
      onContextMenu={noMenu}
    >
      {photo}
      {shield}
      <div aria-hidden="true" className="cover-scrim absolute inset-0" />
      <div className="relative p-6">
        <Logo variant="light" className="h-12" />
      </div>
      <div className="relative flex flex-col items-center gap-6 px-6 pb-10 text-center">
        {titleBlock}
        <ScrollCue
          embedded={embedded}
          label={scrollLabel}
          onScroll={onScroll}
          className="text-white/80 hover:text-white"
        />
      </div>
    </header>
  );
}

function ScrollCue({
  embedded,
  label,
  onScroll,
  className,
}: {
  embedded: boolean;
  label: string;
  onScroll?: () => void;
  className: string;
}) {
  const cls = `text-micro-label flex min-h-11 flex-col items-center gap-1 uppercase ${className}`;
  return embedded ? (
    <span aria-hidden="true" className={cls}>
      {label}
      <ChevronDown className="size-5" />
    </span>
  ) : (
    <button
      type="button"
      onClick={onScroll}
      className={`${cls} duration-base ease-out-soft transition-colors`}
    >
      {label}
      <ChevronDown className="size-5" aria-hidden="true" />
    </button>
  );
}
