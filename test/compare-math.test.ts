import { describe, expect, it } from "vitest";
import {
  clampPct,
  comparePair,
  pointerPct,
  revealClip,
  stepPct,
} from "../app/components/lightbox/compare-math";
import type { GalleryPhoto } from "../app/components/types";

const ver = (n: number) => ({
  n,
  round: null,
  at: "2026-03-01T00:00:00Z",
  v: `t${n}`,
});
const photo = (over: Partial<GalleryPhoto>): GalleryPhoto => ({
  id: "A",
  width: 3,
  height: 2,
  set: "S",
  variants: { web: true, ig: false },
  ...over,
});

describe("T6.53e comparePair", () => {
  it("compares the shown version with the previous one the history lists", () => {
    const p = photo({ ver: 3, versions: [ver(1), ver(2), ver(3)] });
    expect(comparePair(p)).toEqual({ shown: ver(3), previous: ver(2) });
  });
  it("skips a version the payload does not list (no image): v3 vs v1", () => {
    const p = photo({ ver: 3, versions: [ver(1), ver(3)] });
    expect(comparePair(p)?.previous.n).toBe(1);
  });
  it("compares the SHOWN version, not the newest listed one", () => {
    const p = photo({ ver: 2, versions: [ver(1), ver(2), ver(4)] });
    expect(comparePair(p)).toEqual({ shown: ver(2), previous: ver(1) });
  });
  it("is null with no history, no previous, no shown version, or no image", () => {
    expect(comparePair(photo({}))).toBeNull();
    expect(comparePair(photo({ ver: 2 }))).toBeNull();
    expect(
      comparePair(photo({ ver: 1, versions: [ver(1), ver(2)] })),
    ).toBeNull();
    expect(
      comparePair(photo({ ver: 5, versions: [ver(1), ver(2)] })),
    ).toBeNull();
    expect(
      comparePair(
        photo({ ver: 2, versions: [ver(1), ver(2)], noPreview: true }),
      ),
    ).toBeNull();
    expect(
      comparePair(photo({ ver: 0, versions: [ver(0), ver(1)] })),
    ).toBeNull();
  });
  it("does not depend on the order of the list", () => {
    const p = photo({ ver: 3, versions: [ver(3), ver(1), ver(2)] });
    expect(comparePair(p)?.previous.n).toBe(2);
  });
});

describe("T6.53e slider math", () => {
  it("clampPct keeps 0..100 and turns NaN/Infinity into the middle", () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(0)).toBe(0);
    expect(clampPct(37.5)).toBe(37.5);
    expect(clampPct(100)).toBe(100);
    expect(clampPct(140)).toBe(100);
    expect(clampPct(Number.NaN)).toBe(50);
    expect(clampPct(Number.POSITIVE_INFINITY)).toBe(50);
  });
  it("pointerPct maps the pointer onto the frame, clamped at both edges", () => {
    expect(pointerPct(150, 100, 200, false)).toBe(25);
    expect(pointerPct(100, 100, 200, false)).toBe(0);
    expect(pointerPct(300, 100, 200, false)).toBe(100);
    expect(pointerPct(-50, 100, 200, false)).toBe(0);
    expect(pointerPct(900, 100, 200, false)).toBe(100);
  });
  it("pointerPct counts from the right edge in RTL", () => {
    expect(pointerPct(250, 100, 200, true)).toBe(25);
    expect(pointerPct(300, 100, 200, true)).toBe(0);
    expect(pointerPct(100, 100, 200, true)).toBe(100);
  });
  it("pointerPct with a zero, negative or NaN width or NaN pointer stays at the middle", () => {
    expect(pointerPct(150, 100, 0, false)).toBe(50);
    expect(pointerPct(150, 100, -3, false)).toBe(50);
    expect(pointerPct(150, 100, Number.NaN, false)).toBe(50);
    expect(pointerPct(Number.NaN, 100, 200, false)).toBe(50);
    expect(pointerPct(150, 100, 0, true)).toBe(50);
  });
  it("stepPct: arrows move the handle the way it looks, Home/End/Page jump, others are ignored", () => {
    expect(stepPct(50, "ArrowRight", false)).toBe(55);
    expect(stepPct(50, "ArrowLeft", false)).toBe(45);
    expect(stepPct(50, "ArrowUp", false)).toBe(55);
    expect(stepPct(50, "ArrowDown", false)).toBe(45);
    expect(stepPct(50, "ArrowRight", true)).toBe(45);
    expect(stepPct(50, "ArrowLeft", true)).toBe(55);
    expect(stepPct(50, "Home", false)).toBe(0);
    expect(stepPct(50, "End", false)).toBe(100);
    expect(stepPct(50, "PageUp", false)).toBe(70);
    expect(stepPct(50, "PageDown", false)).toBe(30);
    expect(stepPct(50, "a", false)).toBeNull();
    expect(stepPct(50, " ", false)).toBeNull();
  });
  it("stepPct clamps and recovers from NaN", () => {
    expect(stepPct(98, "ArrowRight", false)).toBe(100);
    expect(stepPct(2, "ArrowLeft", false)).toBe(0);
    expect(stepPct(0, "ArrowLeft", false)).toBe(0);
    expect(stepPct(100, "ArrowRight", false)).toBe(100);
    expect(stepPct(Number.NaN, "ArrowRight", false)).toBe(55);
  });
  it("revealClip shows the shown version from the start edge up to the handle", () => {
    expect(revealClip(50, false)).toBe("inset(0 50% 0 0)");
    expect(revealClip(0, false)).toBe("inset(0 100% 0 0)");
    expect(revealClip(100, false)).toBe("inset(0 0% 0 0)");
    expect(revealClip(25, true)).toBe("inset(0 0 0 75%)");
    expect(revealClip(Number.NaN, false)).toBe("inset(0 50% 0 0)");
    expect(revealClip(-9, false)).toBe("inset(0 100% 0 0)");
  });
});
