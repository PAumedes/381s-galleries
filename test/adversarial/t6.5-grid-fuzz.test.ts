import { describe, expect, it } from "vitest";
import { columnsLayout, squareLayout } from "../../app/lib/grid-layout";

function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
}
describe("T6.5 grid layouts", () => {
  it("masonry reading order == photo order; finite numbers", () => {
    const r = rng(7);
    for (let n = 0; n < 300; n++) {
      const photos = Array.from({ length: 1 + Math.floor(r() * 40) }, () => {
        const k = r();
        return k < 0.1
          ? { width: 0, height: 0 }
          : k < 0.2
            ? { width: null, height: 5 }
            : k < 0.3
              ? { width: 1, height: 20000 }
              : k < 0.4
                ? { width: 20000, height: 1 }
                : { width: 1 + Math.floor(r() * 6000), height: 1 + Math.floor(r() * 6000) };
      });
      const W = [1, 17, 100, 320, 639, 640, 1023, 1024, 1500][Math.floor(r() * 9)];
      const gap = [0, 2, 6, 16][Math.floor(r() * 4)];
      const L = columnsLayout(photos, { containerWidth: W, gap });
      if (L.tiles.length === 0) {
        expect(W - gap).toBeLessThanOrEqual(gap + 2);
        continue;
      }
      expect(L.tiles).toHaveLength(photos.length);
      for (const t of L.tiles)
        for (const v of [t.left, t.top, t.width, t.height]) expect(Number.isFinite(v)).toBe(true);
      for (let i = 1; i < L.tiles.length; i++) {
        const a = L.tiles[i - 1], b = L.tiles[i];
        if (!(b.top > a.top || (b.top === a.top && b.left > a.left))) throw new Error(JSON.stringify({W,gap,a,b,i,photos:photos.slice(0,i+1)}));
      }
    }
  });
  it("narrow container never drops photos", () => {
    for (const W of [1, 5, 16, 17, 33, 40]) {
      const photos = [{ width: 1, height: 1 }, { width: 1, height: 1 }, { width: 1, height: 1 }];
      expect(squareLayout(3, { containerWidth: W, gap: 16 }).tiles, `square W=${W}`).toHaveLength(3);
      expect(columnsLayout(photos, { containerWidth: W, gap: 16 }).tiles, `cols W=${W}`).toHaveLength(3);
    }
  });
});
