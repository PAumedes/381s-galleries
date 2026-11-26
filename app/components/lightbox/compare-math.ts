import type { GalleryPhoto, PhotoVersionInfo } from "../types";

/** Where the handle starts and where bad input falls back to (percent). */
const MIDDLE = 50;
const STEP = 5;
const PAGE = 20;

/** A pair to compare: the shown version and the previous one that has an image. */
export type ComparePair = {
  shown: PhotoVersionInfo;
  previous: PhotoVersionInfo;
};

/**
 * The shown version against the newest older version of the history. The
 * history payload only lists versions with an image, so a version without one
 * (a TIFF-only round) is skipped for free. Null when there is nothing to
 * compare (no history, no older version, the placeholder card).
 */
export function comparePair(photo: GalleryPhoto): ComparePair | null {
  const { ver, versions } = photo;
  if (!ver || !versions || photo.noPreview) return null;
  const shown = versions.find((v) => v.n === ver);
  if (!shown) return null;
  let previous: PhotoVersionInfo | null = null;
  for (const v of versions) {
    if (v.n < ver && (!previous || v.n > previous.n)) previous = v;
  }
  return previous ? { shown, previous } : null;
}

/** Percent clamped to 0..100; NaN and infinities fall back to the middle. */
export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return MIDDLE;
  return Math.min(100, Math.max(0, n));
}

/** The handle position (percent from the inline start) of a pointer over the frame. */
export function pointerPct(
  clientX: number,
  left: number,
  width: number,
  rtl: boolean,
): number {
  if (!(width > 0)) return MIDDLE;
  const f = (clientX - left) / width;
  return clampPct((rtl ? 1 - f : f) * 100);
}

/**
 * The handle position after a key, or null for keys the slider ignores.
 * Arrows move the handle the way it looks (mirrored in RTL).
 */
export function stepPct(pct: number, key: string, rtl: boolean): number | null {
  const at = clampPct(pct);
  const dir = rtl ? -1 : 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clampPct(at + dir * STEP);
    case "ArrowLeft":
    case "ArrowDown":
      return clampPct(at - dir * STEP);
    case "PageUp":
      return clampPct(at + PAGE);
    case "PageDown":
      return clampPct(at - PAGE);
    case "Home":
      return 0;
    case "End":
      return 100;
    default:
      return null;
  }
}

/** `clip-path` that keeps the top image from the inline start edge up to the handle. */
export function revealClip(pct: number, rtl: boolean): string {
  const rest = 100 - clampPct(pct);
  return rtl ? `inset(0 0 0 ${rest}%)` : `inset(0 ${rest}% 0 0)`;
}
