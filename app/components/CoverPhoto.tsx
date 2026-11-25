import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { coverObjectPosition, type Focus } from "../lib/cover-focus";
import { MOBILE_COVER_MEDIA } from "../lib/preview-device";

import { FadeImg } from "./FadeImg";

/** The cover is full-bleed: it needs a file as wide as the viewport. */
const COVER_SIZES = "100vw";

export type CoverImage = {
  src: string;
  /** `src` candidates by width (`url 1200w, url 2048w`): phones take the small one. */
  srcSet?: string;
  focus: Focus | null;
  aspect: number | null;
  /** Small version shown until `src` loads (admin previews only). */
  placeholder?: string | null;
};

/** Narrow public viewport (decides which cover file the `<img>` points at). */
function useNarrowViewport(enabled: boolean) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!enabled || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MOBILE_COVER_MEDIA);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, [enabled]);
  return narrow;
}

/**
 * Measure the real frame (the image fills it; layout size is unaffected by
 * the preview's scale transform) so object-position can be computed per
 * axis. SSR / before the first measure: centered.
 */
function useImageFrame(shownSrc: string | null, layout: string) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const setImgNode = useCallback((el: HTMLImageElement | null) => {
    imgRef.current = el;
  }, []);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
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
  return { setImgNode, frame };
}

/**
 * The cover photo: picks desktop or mobile file, measures its frame and
 * places the focal point. Renders nothing without a file.
 */
export function CoverPhoto({
  src,
  srcSet,
  placeholder,
  focus,
  aspect,
  mobile,
  device,
  embedded,
  layout,
}: {
  src: string | null;
  srcSet?: string;
  placeholder: string | null;
  focus: Focus | null;
  aspect: number | null;
  mobile: CoverImage | null;
  device?: "desktop" | "mobile";
  embedded: boolean;
  layout: string;
}) {
  const narrow = useNarrowViewport(!device && !!mobile);
  const active =
    mobile && (device ? device === "mobile" : narrow) ? mobile : null;
  // Narrow public viewport: the `<picture>` source already picks the mobile
  // file; also pointing the `<img>` at it covers browsers that ignore
  // `<source media>` (same URL, so no second download).
  const shownSrc = active ? active.src : src;
  const shownSrcSet = active ? active.srcSet : srcSet;
  const { setImgNode, frame } = useImageFrame(shownSrc, layout);
  const pos = coverObjectPosition(
    active ? active.focus : focus,
    active ? active.aspect : aspect,
    frame,
  );
  // Public page with a mobile cover: the browser picks the file by viewport.
  const sources =
    mobile && !device ? (
      <source
        media={MOBILE_COVER_MEDIA}
        srcSet={mobile.srcSet ?? mobile.src}
        sizes={mobile.srcSet ? COVER_SIZES : undefined}
      />
    ) : undefined;
  // Mobile cover without a desktop one: no `src`, phones still pick the source.
  if (!shownSrc && !sources) return null;
  return (
    <FadeImg
      sources={sources}
      onElement={setImgNode}
      placeholder={active ? active.placeholder : placeholder}
      data-cover-img=""
      data-cover-device={active ? "mobile" : "desktop"}
      src={shownSrc ?? undefined}
      srcSet={shownSrcSet}
      sizes={shownSrcSet ? COVER_SIZES : undefined}
      alt=""
      fetchPriority={embedded ? undefined : "high"}
      draggable={false}
      style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
      className="absolute inset-0 size-full object-cover"
    />
  );
}
