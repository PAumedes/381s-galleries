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

export function justify(
  photos: readonly JustifyInput[],
  opts: JustifyOptions,
): JustifiedLayout {
  const W = Math.floor(opts.containerWidth);
  if (!Number.isFinite(W) || W <= 0 || photos.length === 0) {
    return { tiles: [], height: 0 };
  }
  const num = (v: number | undefined, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : d;
  const gap = Math.max(0, Math.round(num(opts.gap, 6)));
  const target = Math.max(
    1,
    num(opts.targetRowHeight, opts.containerWidth < 640 ? 180 : 280),
  );
  const max = Math.max(target, num(opts.maxRowHeight, target * 1.5));
  const aspects = photos.map(aspectOf);

  const tiles: JustifiedTile[] = [];
  let top = 0;
  let start = 0;

  // Row height that makes aspects[start..end) fill W exactly.
  const fitHeight = (end: number) => {
    let sum = 0;
    for (let i = start; i < end; i++) sum += aspects[i];
    return (W - gap * (end - start - 1)) / sum;
  };

  while (start < photos.length) {
    // Grow the row until it would be at least as wide as the container.
    let end = start;
    let sum = 0;
    while (end < photos.length) {
      sum += aspects[end];
      end++;
      if (sum * target + gap * (end - start - 1) >= W) break;
    }
    const full = sum * target + gap * (end - start - 1) >= W;

    if (!full) {
      // Last row: keep the target height, left-aligned, never stretched.
      const h = Math.max(1, Math.round(target));
      let left = 0;
      for (let i = start; i < end; i++) {
        const width = Math.max(1, Math.round(aspects[i] * h));
        tiles.push({ index: i, left, top, width, height: h });
        left += width + gap;
      }
      break;
    }

    // Pick whichever of {with, without} the last photo is closer to target.
    if (end - start > 1) {
      const hWith = fitHeight(end);
      const hWithout = fitHeight(end - 1);
      if (hWithout <= max && hWithout - target < target - hWith) end--;
    }

    const n = end - start;
    const h = Math.max(1, Math.round(fitHeight(end)));
    const avail = W - gap * (n - 1);
    let rowSum = 0;
    for (let i = start; i < end; i++) rowSum += aspects[i];
    const scale = avail / rowSum;
    const widths = [];
    let used = 0;
    for (let i = start; i < end; i++) {
      const w = Math.max(1, Math.floor(aspects[i] * scale));
      widths.push(w);
      used += w;
    }
    // Distribute the rounding remainder one pixel at a time (can be negative
    // only if the 1px minimum pushed us over; trim from the widest then).
    let rem = avail - used;
    for (let k = 0; rem > 0; k = (k + 1) % n, rem--) widths[k]++;
    while (rem < 0) {
      let wi = 0;
      for (let k = 1; k < n; k++) if (widths[k] > widths[wi]) wi = k;
      if (widths[wi] <= 1) break;
      widths[wi]--;
      rem++;
    }
    let left = 0;
    for (let k = 0; k < n; k++) {
      tiles.push({ index: start + k, left, top, width: widths[k], height: h });
      left += widths[k] + gap;
    }
    top += h + gap;
    start = end;
  }

  const last = tiles[tiles.length - 1];
  return { tiles, height: last.top + last.height };
}
