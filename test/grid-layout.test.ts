import { describe, expect, it } from "vitest";
import {
  columnsLayout,
  gridColumns,
  squareLayout,
} from "../app/lib/grid-layout";

describe("gridColumns: 4 / 3 / 2 by width", () => {
  it.each([
    [1600, 4],
    [1024, 4],
    [1023, 3],
    [640, 3],
    [639, 2],
    [320, 2],
  ])("%ipx -> %i columns", (w, n) => {
    expect(gridColumns(w)).toBe(n);
  });
});

describe("squareLayout (Cuadricula)", () => {
  it("places uniform squares row-major, in photo order, with the gap", () => {
    const { tiles, height } = squareLayout(9, {
      containerWidth: 1200,
      gap: 10,
    });
    const col = (1200 - 30) / 4;
    expect(tiles).toHaveLength(9);
    tiles.forEach((t, i) => {
      expect(t.index).toBe(i);
      expect(t.width).toBeCloseTo(col, 5);
      expect(t.height).toBeCloseTo(col, 5);
      expect(t.left).toBeCloseTo((i % 4) * (col + 10), 5);
      expect(t.top).toBeCloseTo(Math.floor(i / 4) * (col + 10), 5);
    });
    expect(height).toBeCloseTo(3 * col + 2 * 10, 5);
  });
  it("uses 3 columns at 800px and 2 at 400px; gap 2 and 16", () => {
    const a = squareLayout(6, { containerWidth: 800, gap: 2 });
    expect(a.tiles[3].top).toBeGreaterThan(0);
    expect(a.tiles[2].left + a.tiles[2].width).toBeCloseTo(800, 5);
    const b = squareLayout(4, { containerWidth: 400, gap: 16 });
    expect(b.tiles[1].left).toBeCloseTo(400 / 2 + 8, 5);
    expect(b.tiles[2].top).toBeCloseTo(b.tiles[0].height + 16, 5);
  });
  it("empty or degenerate input gives an empty layout", () => {
    expect(squareLayout(0, { containerWidth: 800, gap: 6 })).toEqual({
      tiles: [],
      height: 0,
    });
    expect(squareLayout(3, { containerWidth: 0, gap: 6 }).tiles).toEqual([]);
    expect(squareLayout(3, { containerWidth: NaN, gap: 6 }).tiles).toEqual([]);
  });
});

describe("columnsLayout (Columnas, masonry)", () => {
  const sizes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      width: i % 3 === 2 ? 2000 : 3000,
      height: i % 3 === 2 ? 3000 : 2000,
    }));

  it("keeps each photo's aspect and stays inside the container", () => {
    const photos = sizes(11);
    const { tiles } = columnsLayout(photos, { containerWidth: 1000, gap: 6 });
    expect(tiles).toHaveLength(11);
    for (const t of tiles) {
      const p = photos[t.index];
      // heights are whole pixels so that equal column tops tie exactly
      expect(
        Math.abs(t.height - t.width / (p.width! / p.height!)),
      ).toBeLessThanOrEqual(0.5);
      expect(Number.isInteger(t.height)).toBe(true);
      expect(t.left).toBeGreaterThanOrEqual(0);
      expect(t.left + t.width).toBeLessThanOrEqual(1000 + 1e-6);
    }
  });
  it("puts each photo in the shortest column (first columns on ties)", () => {
    const { tiles } = columnsLayout(
      [
        { width: 100, height: 200 }, // tall, col 0
        { width: 100, height: 100 }, // col 1
        { width: 100, height: 100 }, // col 1 again (shorter than col 0) -> under #1
      ],
      { containerWidth: 640, gap: 0 }, // 3 columns
    );
    expect(tiles[0].left).toBe(0);
    expect(tiles[1].left).toBeGreaterThan(0);
    expect(tiles[2].left).toBeGreaterThan(tiles[1].left);
    const four = columnsLayout(
      Array.from({ length: 5 }, () => ({ width: 100, height: 100 })),
      { containerWidth: 1200, gap: 4 },
    ).tiles;
    expect(four[4].left).toBe(0);
    expect(four[4].top).toBeCloseTo(four[0].height + 4, 5);
  });
  it("gap separates columns and stacked tiles", () => {
    const { tiles } = columnsLayout(
      Array.from({ length: 8 }, () => ({ width: 100, height: 100 })),
      { containerWidth: 1200, gap: 16 },
    );
    const col = (1200 - 3 * 16) / 4;
    expect(tiles[1].left).toBeCloseTo(col + 16, 5);
    expect(tiles[4].top).toBeCloseTo(col + 16, 5);
  });
  it("index order IS the visual order (top, then left) for any aspects", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const w of [400, 800, 1300]) {
      const photos = Array.from({ length: 60 }, () => ({
        width: 1000,
        height: Math.round(500 + rnd() * 2000),
      }));
      const { tiles } = columnsLayout(photos, { containerWidth: w, gap: 6 });
      const visual = [...tiles]
        .sort((a, b) => a.top - b.top || a.left - b.left)
        .map((t) => t.index);
      expect(visual).toEqual(photos.map((_, i) => i));
    }
  });
  it("missing dimensions fall back to 3:2; height is the tallest column", () => {
    const { tiles, height } = columnsLayout([{ width: null, height: null }], {
      containerWidth: 1000,
      gap: 6,
    });
    expect(tiles[0].height).toBe(Math.round(tiles[0].width / 1.5));
    expect(height).toBeCloseTo(tiles[0].height, 5);
  });
  it("empty / invalid width gives an empty layout", () => {
    expect(columnsLayout([], { containerWidth: 800, gap: 6 }).height).toBe(0);
    expect(
      columnsLayout(sizes(3), { containerWidth: -5, gap: 6 }).tiles,
    ).toEqual([]);
  });
});
