import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Lightbox } from "../../app/components/Lightbox";
import { makeT } from "../../app/i18n/t";
import { es } from "../../app/i18n/es";
import { photos, t } from "./fixtures";

const KEY = "swipe-hint:v1";
let coarse = true;
let reduced = false;

function stubMatchMedia() {
  window.matchMedia = ((q: string) => ({
    matches: q.includes("pointer: coarse")
      ? coarse
      : q.includes("prefers-reduced-motion")
        ? reduced
        : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function open(index = 3, n = 10, tt = t) {
  return render(
    <Lightbox
      photos={photos(n)}
      index={index}
      t={tt}
      onClose={() => {}}
      onIndexChange={() => {}}
    />,
  );
}
const hint = () => document.querySelector("[data-swipe-hint]");
const chevrons = () =>
  Array.from(document.querySelectorAll("[data-swipe-hint-chevron]"));

beforeEach(() => {
  vi.useFakeTimers();
  coarse = true;
  reduced = false;
  localStorage.clear();
  stubMatchMedia();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("T6.28 swipe hint", () => {
  it("shows chevrons and an aria-hidden label on first open on touch", () => {
    open();
    expect(hint()).not.toBeNull();
    expect(chevrons()).toHaveLength(2);
    for (const c of chevrons())
      expect(c.getAttribute("aria-hidden")).toBe("true");
    const label = screen.getByText("Swipe");
    expect(label.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("uses the Spanish label", () => {
    open(3, 10, makeT("es", es));
    expect(screen.getByText("Deslizá")).toBeTruthy();
  });

  it("fades out after ~2s and is removed", () => {
    open();
    act(() => void vi.advanceTimersByTime(1900));
    expect(hint()).not.toBeNull();
    expect(hint()?.getAttribute("data-state")).toBe("on");
    act(() => void vi.advanceTimersByTime(200));
    expect(hint()?.getAttribute("data-state")).toBe("fading");
    expect(localStorage.getItem(KEY)).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1000));
    expect(hint()).toBeNull();
  });

  it("a quick close before the hint finishes does not burn the flag", () => {
    open().unmount();
    expect(localStorage.getItem(KEY)).toBeNull();
    open();
    expect(hint()).not.toBeNull();
  });

  it("never shows again once seen (remount)", () => {
    const first = open();
    act(() => void vi.advanceTimersByTime(2100));
    expect(localStorage.getItem(KEY)).not.toBeNull();
    first.unmount();
    open();
    expect(hint()).toBeNull();
  });

  it("does not show on desktop (pointer fine) and does not store", () => {
    coarse = false;
    open();
    expect(hint()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("skips the left chevron on the first photo and the right on the last", () => {
    const a = open(0);
    expect(chevrons().map((c) => c.getAttribute("data-side"))).toEqual([
      "right",
    ]);
    a.unmount();
    localStorage.clear();
    open(9);
    expect(chevrons().map((c) => c.getAttribute("data-side"))).toEqual([
      "left",
    ]);
  });

  it("dismisses on the first pointer down", () => {
    open();
    fireEvent.pointerDown(screen.getByRole("dialog"), {
      pointerId: 1,
      clientX: 5,
      clientY: 5,
    });
    act(() => void vi.advanceTimersByTime(1000));
    expect(hint()).toBeNull();
  });

  it("reduced motion: still shown, no fade phase, removed after the time", () => {
    reduced = true;
    open();
    expect(hint()).not.toBeNull();
    expect(hint()?.className).not.toMatch(/transition|animate/);
    act(() => void vi.advanceTimersByTime(2100));
    expect(hint()).toBeNull();
  });

  it("tolerates localStorage throwing (read and write)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => open()).not.toThrow();
    expect(hint()).not.toBeNull();
  });

  it("clears its timers on unmount", () => {
    const u = open();
    u.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not intercept pointer events", () => {
    open();
    expect(hint()?.className).toMatch(/pointer-events-none/);
  });
});
