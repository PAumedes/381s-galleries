/** Square-grid and masonry-columns layouts. Pure and deterministic. */
import { aspectOf, type JustifiedTile, type JustifyInput } from "./justify";

export type Tile = JustifiedTile;
export type GridLayout = { tiles: Tile[]; height: number };
export type GridLayoutOptions = { containerWidth: number; gap: number };

const EMPTY: GridLayout = { tiles: [], height: 0 };

/** 4 columns from 1024px, 3 from 640px, else 2. */
export function gridColumns(containerWidth: number): number {
  return containerWidth >= 1024 ? 4 : containerWidth >= 640 ? 3 : 2;
}

function setup(o: GridLayoutOptions) {
  const W = o.containerWidth;
  if (!Number.isFinite(W) || W <= 0) return null;
  const gap = Number.isFinite(o.gap) ? Math.max(0, o.gap) : 0;
  const cols = gridColumns(W);
  const col = (W - gap * (cols - 1)) / cols;
  // Never drop photos in very narrow containers: clamp to a 1px column.
  return { gap, cols, col: Math.max(1, col) };
}

/** Cuadricula: uniform squares, row-major (index order is visual order). */
export function squareLayout(count: number, o: GridLayoutOptions): GridLayout {
  const s = setup(o);
  if (!s || count <= 0) return EMPTY;
  const tiles: Tile[] = [];
  for (let i = 0; i < count; i++) {
    tiles.push({
      index: i,
      left: (i % s.cols) * (s.col + s.gap),
      top: Math.floor(i / s.cols) * (s.col + s.gap),
      width: s.col,
      height: s.col,
    });
  }
  const rows = Math.ceil(count / s.cols);
  return { tiles, height: rows * s.col + (rows - 1) * s.gap };
}

/**
 * Columnas: masonry. Each photo goes to the currently shortest column (the
 * leftmost on ties) keeping its aspect ratio. The minimum column height never
 * decreases, so tops are non-decreasing in photo order and, on equal tops,
 * lefts increase: photo order IS the visual (top, left) reading order, which
 * is what the lightbox walks.
 */
export function columnsLayout(
  photos: readonly JustifyInput[],
  o: GridLayoutOptions,
): GridLayout {
  const s = setup(o);
  if (!s || photos.length === 0) return EMPTY;
  const next = new Array<number>(s.cols).fill(0); // top of the next tile
  const tiles: Tile[] = [];
  photos.forEach((p, index) => {
    let c = 0;
    for (let k = 1; k < s.cols; k++) if (next[k] < next[c]) c = k;
    // Whole-pixel heights: equal column tops tie exactly (no float noise), so
    // the leftmost wins and reading order stays the photo order.
    const height = Math.max(1, Math.round(s.col / aspectOf(p)));
    tiles.push({
      index,
      left: c * (s.col + s.gap),
      top: next[c],
      width: s.col,
      height,
    });
    next[c] += height + s.gap;
  });
  return { tiles, height: Math.max(...next) - s.gap };
}
