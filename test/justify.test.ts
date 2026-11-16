import { describe, expect, it } from "vitest";
import { justify } from "../app/lib/justify";

type P = { width: number | null; height: number | null };
const land: P = { width: 3000, height: 2000 }; // 1.5
const port: P = { width: 2000, height: 3000 }; // 0.667
const mix = (n: number): P[] =>
  Array.from({ length: n }, (_, i) => (i % 3 === 2 ? port : land));

function rowsOf(l: ReturnType<typeof justify>) {
  const map = new Map<number, typeof l.tiles>();
  for (const t of l.tiles) map.set(t.top, [...(map.get(t.top) ?? []), t]);
  return [...map.values()];
}

describe("justify", () => {
  it("returns empty for no photos", () => {
    expect(justify([], { containerWidth: 1000 })).toEqual({
      tiles: [],
      height: 0,
    });
  });

  it.each([0, -5, NaN, Infinity])(
    "returns empty for containerWidth %s",
    (w) => {
      expect(justify(mix(5), { containerWidth: w })).toEqual({
        tiles: [],
        height: 0,
      });
    },
  );

  it("non-last rows sum exactly to the container width (with gaps)", () => {
    for (const W of [320, 375, 640, 777, 1000, 1233, 1440]) {
      const l = justify(mix(40), { containerWidth: W });
      const rows = rowsOf(l);
      expect(rows.length).toBeGreaterThan(1);
      for (const row of rows.slice(0, -1)) {
        const sum = row.reduce((s, t) => s + t.width, 0) + 6 * (row.length - 1);
        expect(sum).toBe(W);
      }
    }
  });

  it("tiles in a row are contiguous, share top and height, and never overlap", () => {
    const l = justify(mix(30), { containerWidth: 1000, gap: 6 });
    for (const row of rowsOf(l)) {
      expect(new Set(row.map((t) => t.height)).size).toBe(1);
      let x = 0;
      for (const t of row) {
        expect(t.left).toBe(x);
        x += t.width + 6;
      }
    }
  });

  it("keeps original order via index", () => {
    const l = justify(mix(12), { containerWidth: 900 });
    expect(l.tiles.map((t) => t.index)).toEqual([...Array(12).keys()]);
  });

  it("does not stretch the last row: target height, left-aligned", () => {
    const l = justify(mix(7), { containerWidth: 1000, targetRowHeight: 280 });
    const rows = rowsOf(l);
    const last = rows[rows.length - 1];
    expect(last[0].left).toBe(0);
    expect(last[0].height).toBe(280);
    const sum = last.reduce((s, t) => s + t.width, 0) + 6 * (last.length - 1);
    expect(sum).toBeLessThanOrEqual(1000);
  });

  it("single landscape photo keeps target height, not full width", () => {
    const l = justify([land], { containerWidth: 1200, targetRowHeight: 280 });
    expect(l.tiles).toHaveLength(1);
    expect(l.tiles[0]).toMatchObject({
      index: 0,
      left: 0,
      top: 0,
      height: 280,
      width: 420,
    });
    expect(l.height).toBe(280);
  });

  it("single photo wider than the container shrinks to fit", () => {
    const pano = { width: 10000, height: 1000 };
    const l = justify([pano], { containerWidth: 500, targetRowHeight: 280 });
    expect(l.tiles[0].width).toBe(500);
    expect(l.tiles[0].height).toBe(50);
  });

  it("null dimensions default to a 1.5 landscape aspect", () => {
    const a = justify([{ width: null, height: null }], { containerWidth: 900 });
    const b = justify([land], { containerWidth: 900 });
    expect(a).toEqual(b);
    const c = justify([{ width: 100, height: null }], { containerWidth: 900 });
    expect(c).toEqual(b);
    const d = justify([{ width: 0, height: 0 }], { containerWidth: 900 });
    expect(d).toEqual(b);
  });

  it("non-last rows never exceed maxRowHeight (default 1.5x target)", () => {
    const wides = Array.from({ length: 3 }, () => ({
      width: 6000,
      height: 1000,
    }));
    const l = justify([...wides, ...mix(10)], {
      containerWidth: 1000,
      targetRowHeight: 280,
    });
    for (const row of rowsOf(l).slice(0, -1)) {
      expect(row[0].height).toBeLessThanOrEqual(420);
    }
  });

  it("respects an explicit maxRowHeight", () => {
    const l = justify(mix(30), {
      containerWidth: 1000,
      targetRowHeight: 200,
      maxRowHeight: 210,
    });
    for (const row of rowsOf(l).slice(0, -1)) {
      expect(row[0].height).toBeLessThanOrEqual(210);
    }
  });

  it("extreme aspects keep widths >= 1 and everything finite", () => {
    const ps: P[] = [
      { width: 1, height: 100000 },
      { width: 100000, height: 1 },
      land,
      { width: 1, height: 1 },
    ];
    const l = justify(ps, { containerWidth: 300 });
    for (const t of l.tiles) {
      expect(Number.isFinite(t.width)).toBe(true);
      expect(Number.isFinite(t.height)).toBe(true);
      expect(t.width).toBeGreaterThanOrEqual(1);
      expect(t.height).toBeGreaterThanOrEqual(1);
      expect(t.left + t.width).toBeLessThanOrEqual(300);
    }
  });

  it("defaults the target to 280 on desktop and 180 below 640px", () => {
    expect(justify([land], { containerWidth: 1200 }).tiles[0].height).toBe(280);
    expect(justify([land], { containerWidth: 600 }).tiles[0].height).toBe(180);
    expect(justify([land], { containerWidth: 640 }).tiles[0].height).toBe(280);
  });

  it("total height is bottom of last row", () => {
    const l = justify(mix(20), { containerWidth: 1000 });
    const lastTile = l.tiles[l.tiles.length - 1];
    expect(l.height).toBe(lastTile.top + lastTile.height);
  });

  it("is deterministic and does not mutate input", () => {
    const input = mix(25);
    const copy = structuredClone(input);
    const a = justify(input, { containerWidth: 1111 });
    const b = justify(input, { containerWidth: 1111 });
    expect(a).toEqual(b);
    expect(input).toEqual(copy);
  });
});
