import { describe, expect, it } from "vitest";
import { justify } from "../../app/lib/justify";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("justify properties", () => {
  it("full rows sum exactly to W and nothing overflows (seeded random)", () => {
    const r = rng(42);
    for (let iter = 0; iter < 300; iter++) {
      const W = 100 + Math.floor(r() * 2400);
      const n = 1 + Math.floor(r() * 60);
      const photos = Array.from({ length: n }, () => {
        const k = r();
        const a =
          k < 0.05 ? 4 + r() * 8 : k < 0.1 ? 0.05 + r() * 0.2 : 0.5 + r() * 1.8;
        return { width: Math.round(a * 1000), height: 1000 };
      });
      const gap = Math.floor(r() * 12);
      const { tiles } = justify(photos, { containerWidth: W, gap });
      expect(tiles.length).toBe(n);
      const rows = new Map<number, typeof tiles>();
      for (const t of tiles) rows.set(t.top, [...(rows.get(t.top) ?? []), t]);
      const tops = [...rows.keys()].sort((a, b) => a - b);
      tops.forEach((top, ri) => {
        const row = rows.get(top)!;
        const end = row[row.length - 1];
        const right = end.left + end.width;
        expect(
          right,
          `overflow W=${W} gap=${gap} row=${ri}`,
        ).toBeLessThanOrEqual(W);
        if (ri < tops.length - 1)
          expect(right, `W=${W} gap=${gap} row=${ri}`).toBe(W);
      });
    }
  });

  it("NaN / Infinity options never produce NaN geometry", () => {
    const ph = [
      { width: 3, height: 2 },
      { width: 3, height: 2 },
      { width: 2, height: 3 },
    ];
    for (const o of [
      { containerWidth: 1000, gap: NaN },
      { containerWidth: 1000, targetRowHeight: NaN },
      { containerWidth: 1000, targetRowHeight: Infinity },
      { containerWidth: 1000, gap: Infinity },
      { containerWidth: 1000, maxRowHeight: NaN },
    ]) {
      const { tiles, height } = justify(ph, o);
      expect(Number.isFinite(height), JSON.stringify(o)).toBe(true);
      for (const t of tiles) {
        for (const v of [t.left, t.top, t.width, t.height]) {
          expect(Number.isFinite(v), JSON.stringify(o)).toBe(true);
        }
      }
    }
  });

  it("huge gap does not overflow the container", () => {
    const ph = Array.from({ length: 4 }, () => ({ width: 3, height: 2 }));
    const { tiles } = justify(ph, { containerWidth: 300, gap: 300 });
    for (const t of tiles) expect(t.left + t.width).toBeLessThanOrEqual(300);
  });

  it("3000 photos lay out quickly", () => {
    const r = rng(7);
    const ph = Array.from({ length: 3000 }, () => ({
      width: 1000 + Math.floor(r() * 2000),
      height: 1000 + Math.floor(r() * 2000),
    }));
    justify(ph, { containerWidth: 1200 });
    const t0 = performance.now();
    justify(ph, { containerWidth: 1200 });
    expect(performance.now() - t0).toBeLessThan(20);
  });

  it("rows never exceed maxRowHeight (except last-row target)", () => {
    const ph = Array.from({ length: 40 }, (_, i) => ({
      width: i % 7 === 0 ? 12000 : 3000,
      height: 2000,
    }));
    const { tiles } = justify(ph, { containerWidth: 1200 });
    for (const t of tiles) expect(t.height).toBeLessThanOrEqual(420);
  });
});
