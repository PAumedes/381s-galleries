import { useRef, useState } from "react";

import type { TFunction } from "../../i18n/t";
import { pointerPct, revealClip, stepPct } from "./compare-math";

export type CompareMode = "flip" | "slide";

/** Both previews share one class: same box, `object-contain`, so they letterbox the same way. */
const IMG = "absolute inset-0 size-full select-none object-contain";

type Side = { n: number; src: string };

type FrameProps = {
  t: TFunction;
  mode: CompareMode;
  /** The shown (newer) version, drawn on top. */
  top: Side;
  /** The previous version, drawn underneath. */
  under: Side;
  /** Flip mode: showing the previous version. */
  flipped: boolean;
  onFlip: () => void;
  rtl: boolean;
  /** Hidden (but loading) until both previews are in. */
  ready: boolean;
  onLoad: () => void;
  onError: () => void;
};

/**
 * The two previews in one fixed frame. Flip: one button, A/B by opacity (both
 * stay loaded). Slide: the top image is clipped up to the handle (`clip-path`).
 */
export function CompareFrame(p: FrameProps) {
  const [pct, setPct] = useState(50);
  const dragging = useRef<number | null>(null);
  const slide = p.mode === "slide";
  const frame = useRef<HTMLDivElement>(null);
  const moveTo = (clientX: number) => {
    const r = frame.current?.getBoundingClientRect();
    if (r) setPct(pointerPct(clientX, r.left, r.width, p.rtl));
  };
  const images = (
    <>
      <img
        data-testid="compare-img-b"
        src={p.under.src}
        alt=""
        draggable={false}
        className={IMG}
        style={{ opacity: !slide && !p.flipped ? 0 : 1 }}
        data-active={String(slide || p.flipped)}
        onLoad={p.onLoad}
        onError={p.onError}
      />
      <img
        data-testid="compare-img-a"
        src={p.top.src}
        alt=""
        draggable={false}
        className={IMG}
        style={{
          opacity: !slide && p.flipped ? 0 : 1,
          clipPath: slide ? revealClip(pct, p.rtl) : undefined,
        }}
        data-active={String(slide || !p.flipped)}
        onLoad={p.onLoad}
        onError={p.onError}
      />
    </>
  );
  return (
    <div
      ref={frame}
      data-testid="compare-frame"
      className={`relative size-full overflow-hidden ${slide ? "touch-pan-y touch-pinch-zoom" : ""}`}
      style={{ opacity: p.ready ? 1 : 0 }}
      {...(slide && {
        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
          e.stopPropagation();
          dragging.current = e.pointerId;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          moveTo(e.clientX);
        },
        onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
          e.stopPropagation();
          if (dragging.current === e.pointerId) moveTo(e.clientX);
        },
        onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
          e.stopPropagation();
          dragging.current = null;
        },
        onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => {
          e.stopPropagation();
          dragging.current = null;
        },
      })}
    >
      {images}
      {slide ? (
        <Handle
          t={p.t}
          a={p.top.n}
          b={p.under.n}
          pct={pct}
          rtl={p.rtl}
          onPct={setPct}
        />
      ) : (
        <button
          type="button"
          data-testid="compare-flip"
          aria-label={p.t("compare.flipLabel", { a: p.top.n, b: p.under.n })}
          className="absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
          onClick={p.onFlip}
        />
      )}
    </div>
  );
}

type HandleProps = {
  t: TFunction;
  a: number;
  b: number;
  pct: number;
  rtl: boolean;
  onPct: (pct: number) => void;
};

/** The draggable divider; the focusable slider (keys: arrows, Page, Home, End). */
function Handle({ t, a, b, pct, rtl, onPct }: HandleProps) {
  const edge = rtl ? "right" : "left";
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-valuetext={t("compare.sliderValue", { a, pct: Math.round(pct) })}
      aria-label={t("compare.slider", { a, b })}
      data-testid="compare-handle"
      className="absolute inset-y-0 flex w-11 -translate-x-1/2 cursor-ew-resize items-center justify-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white rtl:translate-x-1/2"
      style={{ [edge]: `${pct}%` }}
      onKeyDown={(e) => {
        if (e.metaKey || e.altKey || e.ctrlKey) return;
        const next = stepPct(pct, e.key, rtl);
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        onPct(next);
      }}
    >
      <span
        aria-hidden="true"
        className="h-full w-0.5 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
      />
      <span
        aria-hidden="true"
        className="absolute size-9 rounded-full border-2 border-white bg-black/50"
      />
    </div>
  );
}
