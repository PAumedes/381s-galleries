/** Justified-rows (Flickr-style) layout. Pure and deterministic. */

export type JustifyInput = { width: number | null; height: number | null };

export type JustifyOptions = {
  containerWidth: number;
  /** Default 280, or 180 when the container is narrower than 640px. */
  targetRowHeight?: number;
  /** Default 6. */
  gap?: number;
  /** Default 1.5 x target. */
  maxRowHeight?: number;
};

export type JustifiedTile = {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type JustifiedLayout = { tiles: JustifiedTile[]; height: number };

const DEFAULT_ASPECT = 1.5;

export function aspectOf(p: JustifyInput): number {
  const { width: w, height: h } = p;
  if (!w || !h || !(w > 0) || !(h > 0)) return DEFAULT_ASPECT;
  const a = w / h;
  return Number.isFinite(a) && a > 0 ? a : DEFAULT_ASPECT;
}

type Metrics = { W: number; gap: number; target: number; max: number };

/** Container width, gap and row-height bounds from the options (null: nothing to lay out). */
function metricsOf(opts: JustifyOptions): Metrics | null {
  const W = Math.floor(opts.containerWidth);
  if (!Number.isFinite(W) || W <= 0) return null;
  const num = (v: number | undefined, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : d;
  const gap = Math.max(0, Math.round(num(opts.gap, 6)));
  const target = Math.max(
    1,
    num(opts.targetRowHeight, opts.containerWidth < 640 ? 180 : 280),
  );
  const max = Math.max(target, num(opts.maxRowHeight, target * 1.5));
  return { W, gap, target, max };
}

const sumAspects = (aspects: number[], from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += aspects[i];
  return sum;
};

/** Row height that makes aspects[start..end) fill W exactly. */
const fitHeight = (aspects: number[], m: Metrics, start: number, end: number) =>
  (m.W - m.gap * (end - start - 1)) / sumAspects(aspects, start, end);

/** Grows the row from `start` until it would be at least as wide as the container (`full`). */
function growRow(aspects: number[], m: Metrics, start: number) {
  let end = start;
  let sum = 0;
  while (end < aspects.length) {
    sum += aspects[end];
    end++;
    if (sum * m.target + m.gap * (end - start - 1) >= m.W) break;
  }
  const full = sum * m.target + m.gap * (end - start - 1) >= m.W;
  return { end, full };
}

/** Pixel widths of a full row: proportional to aspect, the rounding remainder spread one pixel at a time. */
function rowWidths(aspects: number[], m: Metrics, start: number, end: number) {
  const n = end - start;
  const avail = m.W - m.gap * (n - 1);
  const scale = avail / sumAspects(aspects, start, end);
  const widths: number[] = [];
  let used = 0;
  for (let i = start; i < end; i++) {
    const w = Math.max(1, Math.floor(aspects[i] * scale));
    widths.push(w);
    used += w;
  }
  // The remainder can be negative only if the 1px minimum pushed us over;
  // trim from the widest then.
  let rem = avail - used;
  for (let k = 0; rem > 0; k = (k + 1) % n, rem--) widths[k]++;
  while (rem < 0) {
    let wi = 0;
    for (let k = 1; k < n; k++) if (widths[k] > widths[wi]) wi = k;
    if (widths[wi] <= 1) break;
    widths[wi]--;
    rem++;
  }
  return widths;
}

/** Tiles of one row, left to right, from per-tile widths. */
function placeRow(
  start: number,
  widths: number[],
  top: number,
  height: number,
  gap: number,
): JustifiedTile[] {
  let left = 0;
  return widths.map((width, k) => {
    const tile = { index: start + k, left, top, width, height };
    left += width + gap;
    return tile;
  });
}

export function justify(
  photos: readonly JustifyInput[],
  opts: JustifyOptions,
): JustifiedLayout {
  const m = metricsOf(opts);
  if (!m || photos.length === 0) return { tiles: [], height: 0 };
  const aspects = photos.map(aspectOf);
  const tiles: JustifiedTile[] = [];
  let top = 0;
  let start = 0;

  while (start < photos.length) {
    const grown = growRow(aspects, m, start);
    let end = grown.end;
    if (!grown.full) {
      // Last row: keep the target height, left-aligned, never stretched.
      const h = Math.max(1, Math.round(m.target));
      const widths = aspects
        .slice(start, end)
        .map((a) => Math.max(1, Math.round(a * h)));
      tiles.push(...placeRow(start, widths, top, h, m.gap));
      break;
    }
    // Pick whichever of {with, without} the last photo is closer to target.
    if (end - start > 1) {
      const hWith = fitHeight(aspects, m, start, end);
      const hWithout = fitHeight(aspects, m, start, end - 1);
      if (hWithout <= m.max && hWithout - m.target < m.target - hWith) end--;
    }
    const h = Math.max(1, Math.round(fitHeight(aspects, m, start, end)));
    tiles.push(
      ...placeRow(start, rowWidths(aspects, m, start, end), top, h, m.gap),
    );
    top += h + m.gap;
    start = end;
  }

  const last = tiles[tiles.length - 1];
  return { tiles, height: last.top + last.height };
}
