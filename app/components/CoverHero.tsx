import { useLayoutEffect, useRef, useState } from "react";
import type { Ref } from "react";

import { coverObjectPosition, type Focus } from "../lib/cover-focus";

import { Logo } from "./Logo";
import { ChevronDown } from "./icons";

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
}) {
  const Title = embedded ? "p" : "h1";
  const imgRef = useRef<HTMLImageElement>(null);
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
  }, [src]);
  const pos = coverObjectPosition(focus, aspect, frame);
  return (
    <header
      ref={headerRef}
      className={`on-dark relative flex w-full flex-col justify-between overflow-hidden bg-night text-white ${embedded ? "h-full" : "h-dvh min-h-96"}${proofing ? " img-protect" : ""}`}
      onContextMenu={proofing ? (e) => e.preventDefault() : undefined}
    >
      {src && (
        <img
          ref={imgRef}
          data-cover-img=""
          src={src}
          alt=""
          fetchPriority={embedded ? undefined : "high"}
          draggable={false}
          style={{
            objectPosition: `${pos.x}% ${pos.y}%`,
          }}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {proofing && src && (
        <span
          data-testid="cover-shield"
          aria-hidden="true"
          className="absolute inset-0"
          onContextMenu={(e) => e.preventDefault()}
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
        <Title className="text-display font-light uppercase">{title}</Title>
        {date && (
          <p className="text-body -mt-3 font-light tracking-wide">{date}</p>
        )}
        <p className="text-micro-label uppercase">{studio}</p>
        {embedded ? (
          <span
            aria-hidden="true"
            className="text-micro-label flex min-h-11 flex-col items-center gap-1 uppercase text-white/80"
          >
            {scrollLabel}
            <ChevronDown className="size-5" />
          </span>
        ) : (
          <button
            type="button"
            onClick={onScroll}
            className="text-micro-label duration-base ease-out-soft flex min-h-11 flex-col items-center gap-1 uppercase text-white/80 transition-colors hover:text-white"
          >
            {scrollLabel}
            <ChevronDown className="size-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
}
