import { describe, expect, it } from "vitest";
import {
  dragOffsets,
  swipeOutcome,
} from "../app/components/lightbox/swipe-math";

// T6.51: exact thresholds of the lightbox swipe (50px / 20px fast / 80px close).
describe("T6.51 swipeOutcome", () => {
  it("navigates at exactly 50px, not at 49", () => {
    expect(swipeOutcome(-50, 0, 1000)).toBe("next");
    expect(swipeOutcome(50, 0, 1000)).toBe("prev");
    expect(swipeOutcome(-49, 0, 1000)).toBeNull();
    expect(swipeOutcome(49, 0, 1000)).toBeNull();
  });
  it("a fast short flick navigates: >= 20px and > 0.5px/ms", () => {
    expect(swipeOutcome(-20, 0, 39)).toBe("next"); // 0.51
    expect(swipeOutcome(20, 0, 39)).toBe("prev");
    expect(swipeOutcome(-20, 0, 40)).toBeNull(); // exactly 0.5: not faster
    expect(swipeOutcome(-19, 0, 1)).toBeNull(); // too short whatever the speed
  });
  it("closes at 80px down, not at 79, and on a fast 40px pull", () => {
    expect(swipeOutcome(0, 80, 1000)).toBe("close");
    expect(swipeOutcome(0, 79, 1000)).toBeNull();
    expect(swipeOutcome(0, 41, 80)).toBe("close"); // 0.51 px/ms
    expect(swipeOutcome(0, 40, 80)).toBeNull(); // exactly 0.5
    expect(swipeOutcome(0, 39, 1)).toBeNull(); // under 40px
  });
  it("a pull up never closes", () => {
    expect(swipeOutcome(0, -200, 10)).toBeNull();
  });
  it("horizontal wins only when strictly larger", () => {
    expect(swipeOutcome(-60, 60, 1000)).toBeNull(); // tie: vertical, 60 < 80
    expect(swipeOutcome(-61, 60, 1000)).toBe("next");
    expect(swipeOutcome(10, 90, 1000)).toBe("close");
  });
});

describe("T6.51 dragOffsets", () => {
  it("follows the finger horizontally", () => {
    expect(dragOffsets(30, 5, false, true, true)).toEqual({ x: 30, y: 0 });
    expect(dragOffsets(-30, 5, true, true, true)).toEqual({ x: -30, y: 0 });
  });
  it("resists a quarter when there is no previous/next to go to", () => {
    expect(dragOffsets(40, 0, false, false, true)).toEqual({ x: 10, y: 0 });
    expect(dragOffsets(-40, 0, false, true, false)).toEqual({ x: -10, y: 0 });
    expect(dragOffsets(40, 0, false, true, false)).toEqual({ x: 40, y: 0 });
    expect(dragOffsets(-40, 0, false, false, true)).toEqual({ x: -40, y: 0 });
  });
  it("vertical: only a pull down once dragging, and never negative", () => {
    expect(dragOffsets(2, 30, true, true, true)).toEqual({ x: 0, y: 30 });
    expect(dragOffsets(2, -30, true, true, true)).toEqual({ x: 0, y: 0 });
    expect(dragOffsets(2, 30, false, true, true)).toEqual({ x: 0, y: null });
  });
});
