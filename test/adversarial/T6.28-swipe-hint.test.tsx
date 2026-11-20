import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Lightbox } from "../../app/components/Lightbox";
import { photos, t } from "../dom/fixtures";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  window.matchMedia = ((q: string) => ({
    matches: q.includes("pointer: coarse"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => vi.useRealTimers());

const open = (n: number, strict = false) => {
  const ui = (
    <Lightbox
      photos={photos(n)}
      index={0}
      t={t}
      onClose={() => {}}
      onIndexChange={() => {}}
    />
  );
  return render(strict ? <StrictMode>{ui}</StrictMode> : ui);
};

describe("T6.28 adversarial", () => {
  it("under StrictMode the hint still disappears after the timeout", () => {
    open(5, true);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(document.querySelector("[data-swipe-hint]")).toBeNull();
  });

  it("single-photo gallery shows no swipe label and does not burn the once-only flag", () => {
    open(1);
    expect(document.querySelector("[data-swipe-hint]")).toBeNull();
    expect(localStorage.getItem("swipe-hint:v1")).toBeNull();
  });
});
