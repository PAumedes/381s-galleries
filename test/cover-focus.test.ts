import { describe, expect, it } from "vitest";
import { axisPosition, coverObjectPosition } from "../app/lib/cover-focus";

describe("axisPosition", () => {
  it("is 50 when the axis is not cropped (S <= F)", () => {
    expect(axisPosition(10, 100, 100)).toBe(50);
    expect(axisPosition(90, 80, 100)).toBe(50);
  });
  it("keeps the point at the center when possible, else clamps", () => {
    expect(axisPosition(50, 200, 100)).toBe(50);
    expect(axisPosition(0, 200, 100)).toBe(0);
    expect(axisPosition(100, 200, 100)).toBe(100);
    // u=60%: 120 - 50 = 70 over 100 of slack
    expect(axisPosition(60, 200, 100)).toBeCloseTo(70);
  });
  it("is 50 for degenerate numbers", () => {
    expect(axisPosition(10, Number.NaN, 100)).toBe(50);
  });
});

describe("coverObjectPosition", () => {
  it("centers when focus/aspect/frame are missing", () => {
    const c = { x: 50, y: 50 };
    expect(coverObjectPosition(null, 1.5, { w: 100, h: 100 })).toEqual(c);
    expect(coverObjectPosition({ x: 1, y: 1 }, null, { w: 1, h: 1 })).toEqual(
      c,
    );
    expect(coverObjectPosition({ x: 1, y: 1 }, 1.5, null)).toEqual(c);
    expect(coverObjectPosition({ x: 1, y: 1 }, 1.5, { w: 0, h: 9 })).toEqual(c);
  });
  it("landscape photo in a tall frame: only x is cropped", () => {
    // image 3:2 in 390x823 -> scaled 1234.5x823; x crops
    const p = coverObjectPosition({ x: 20, y: 10 }, 1.5, { w: 390, h: 823 });
    expect(p.y).toBe(50);
    expect(p.x).toBeCloseTo(((0.2 * 1234.5 - 195) / (1234.5 - 390)) * 100, 3);
  });
  it("portrait photo in a wide frame: only y is cropped", () => {
    const p = coverObjectPosition({ x: 20, y: 35 }, 2 / 3, { w: 1280, h: 720 });
    expect(p.x).toBe(50);
    expect(p.y).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(50);
  });
});
