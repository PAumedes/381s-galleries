import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { Lightbox } from "../../app/components/Lightbox";
import { photos, t } from "./fixtures";

function Harness({ start = 3 }: { start?: number }) {
  const [i, setI] = useState(start);
  return (
    <Lightbox
      photos={photos(30)}
      index={i}
      t={t}
      onClose={() => {}}
      onIndexChange={setI}
    />
  );
}

const cur = () => screen.getByTestId("lightbox-img") as HTMLImageElement;
const next = () =>
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
const prev = () =>
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
const isVisible = (el: Element) => el.className.includes("opacity-100");

describe("Lightbox rapid navigation", () => {
  it("10 quick next clicks: image, alt and counter match the index", () => {
    render(<Harness start={3} />);
    for (let k = 0; k < 10; k++) next();
    expect(cur().getAttribute("src")).toBe("/img/p13/view-sm");
    expect(cur().getAttribute("alt")).toBe("Photo 14");
    expect(screen.getByText("14 / 30")).toBeTruthy();
  });

  it("held ArrowRight (repeated keydown) lands on the right photo", () => {
    render(<Harness start={0} />);
    for (let k = 0; k < 12; k++)
      fireEvent.keyDown(document.body, { key: "ArrowRight", repeat: k > 0 });
    expect(cur().getAttribute("src")).toBe("/img/p12/view-sm");
    expect(screen.getByText("13 / 30")).toBeTruthy();
  });

  it("fast alternating prev/next ends on the right photo", () => {
    render(<Harness start={5} />);
    next();
    next();
    prev();
    next();
    next();
    prev();
    expect(cur().getAttribute("src")).toBe("/img/p7/view-sm");
    expect(screen.getByText("8 / 30")).toBeTruthy();
  });

  it("a late load from an older photo never hides the current one", () => {
    render(<Harness start={3} />);
    const old = cur();
    next();
    const now = cur();
    fireEvent.load(now);
    expect(isVisible(cur())).toBe(true);
    fireEvent.load(old); // stale, arrives after
    expect(cur()).toBe(now);
    expect(isVisible(cur())).toBe(true);
  });

  it("out-of-order loads across 10 navigations leave current visible", () => {
    render(<Harness start={0} />);
    const seen = [cur()];
    for (let k = 0; k < 10; k++) {
      next();
      seen.push(cur());
    }
    const last = seen[seen.length - 1];
    fireEvent.load(last);
    for (const el of [...seen].reverse()) fireEvent.load(el);
    for (const el of seen.slice(0, 5)) fireEvent.load(el);
    expect(cur().getAttribute("src")).toBe("/img/p10/view-sm");
    expect(isVisible(cur())).toBe(true);
    expect(screen.queryByTestId("lightbox-prev")).toBeNull();
  });

  it("keeps the previous image on screen until the new one loads", () => {
    render(<Harness start={3} />);
    fireEvent.load(cur());
    next();
    const prevImg = screen.getByTestId("lightbox-prev");
    expect(prevImg.getAttribute("src")).toContain("/img/p3/");
    expect(isVisible(prevImg)).toBe(true);
    expect(isVisible(cur())).toBe(false);
    fireEvent.load(cur());
    expect(screen.queryByTestId("lightbox-prev")).toBeNull();
    expect(isVisible(cur())).toBe(true);
  });

  it("the previous layer is never a stale image from several steps back", () => {
    render(<Harness start={3} />);
    fireEvent.load(cur()); // p3 loaded
    next(); // p4 pending
    next(); // p5 pending
    next(); // p6 pending
    const p = screen.getByTestId("lightbox-prev");
    expect(p.getAttribute("src")).toContain("/img/p3/");
    expect(cur().getAttribute("src")).toBe("/img/p6/view-sm");
  });

  it("error from a stale photo does not mark the current photo failed", () => {
    render(<Harness start={3} />);
    const old = cur();
    next();
    fireEvent.error(old);
    expect(screen.queryByTestId("lightbox-error")).toBeNull();
    expect(cur().getAttribute("src")).toBe("/img/p4/view-sm");
    prev(); // back to p3, which never really failed: it must try again
    expect(screen.queryByTestId("lightbox-error")).toBeNull();
    expect(cur().getAttribute("src")).toBe("/img/p3/view-sm");
  });

  it("error of the current photo clears when navigating away", () => {
    render(<Harness start={3} />);
    fireEvent.error(cur());
    expect(screen.getByTestId("lightbox-error")).toBeTruthy();
    next();
    expect(screen.queryByTestId("lightbox-error")).toBeNull();
    expect(cur().getAttribute("src")).toBe("/img/p4/view-sm");
    prev();
    expect(screen.queryByTestId("lightbox-error")).toBeNull();
  });

  it("swipe while a fade is running still navigates once and ends consistent", () => {
    render(<Harness start={3} />);
    next();
    const stage = screen.getByTestId("lightbox-stage");
    const ev = { pointerId: 1, pointerType: "touch" };
    fireEvent.pointerDown(stage, { ...ev, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(stage, { ...ev, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(stage, { ...ev, clientX: 100, clientY: 200 });
    expect(cur().getAttribute("src")).toBe("/img/p5/view-sm");
    expect(screen.getByText("6 / 30")).toBeTruthy();
    fireEvent.load(cur());
    expect(isVisible(cur())).toBe(true);
    expect(cur().style.transform).toBe("");
  });

  describe("preloads", () => {
    const RealImage = globalThis.Image;
    let live = 0;
    let peak = 0;
    beforeEach(() => {
      live = 0;
      peak = 0;
      class FakeImage {
        sizes = "";
        srcset = "";
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        private _src = "";
        set src(v: string) {
          if (this._src) live--;
          this._src = v;
          if (v) {
            live++;
            peak = Math.max(peak, live);
          }
        }
        get src() {
          return this._src;
        }
      }
      globalThis.Image = FakeImage as unknown as typeof Image;
    });
    afterEach(() => {
      globalThis.Image = RealImage;
    });

    it("releases stale preloads: in-flight never exceeds the cache size (6)", () => {
      render(<Harness start={0} />);
      for (let k = 0; k < 15; k++) next();
      expect(peak).toBeLessThanOrEqual(6);
      expect(live).toBeLessThanOrEqual(6);
    });
  });

  it("unmount mid-navigation is safe", () => {
    const { unmount } = render(<Harness start={3} />);
    const old = cur();
    next();
    unmount();
    act(() => {
      fireEvent.load(old);
      fireEvent.error(old);
    });
  });
});
