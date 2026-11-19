import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Lightbox } from "../../app/components/Lightbox";
import { ImgUrlProvider } from "../../app/components/img-url";
import type { ImgUrlFn } from "../../app/components/types";
import { photos, t } from "./fixtures";

/**
 * Refactor guard (Lightbox split into hooks): pins behaviour that a mutation
 * of the extracted code would otherwise change unnoticed.
 */

const stable = photos(10);

function setup(props: Partial<React.ComponentProps<typeof Lightbox>> = {}) {
  const onClose = vi.fn();
  const onIndexChange = vi.fn();
  const utils = render(
    <Lightbox
      photos={stable}
      index={3}
      t={t}
      onClose={onClose}
      onIndexChange={onIndexChange}
      {...props}
    />,
  );
  return { onClose, onIndexChange, ...utils };
}

/** A lightbox whose index state is real, so navigation re-renders it. */
function Nav(props: { protect?: boolean; start?: number }) {
  const [i, setI] = useState(props.start ?? 3);
  return (
    <Lightbox
      photos={stable}
      index={i}
      t={t}
      onClose={() => {}}
      onIndexChange={setI}
      protect={props.protect}
    />
  );
}

const stage = () => screen.getByTestId("lightbox-stage");
const dialog = () => screen.getByRole("dialog");
const img = () => screen.getByTestId("lightbox-img") as HTMLImageElement;
const touch = { pointerType: "touch" };
const down = (x: number, y: number, extra = {}) =>
  fireEvent.pointerDown(stage(), {
    ...touch,
    pointerId: 1,
    clientX: x,
    clientY: y,
    ...extra,
  });
const move = (x: number, y: number, extra = {}) =>
  fireEvent.pointerMove(stage(), {
    ...touch,
    pointerId: 1,
    clientX: x,
    clientY: y,
    ...extra,
  });
const up = (x: number, y: number, extra = {}) =>
  fireEvent.pointerUp(stage(), {
    ...touch,
    pointerId: 1,
    clientX: x,
    clientY: y,
    ...extra,
  });

const setScale = (scale: number | null) => {
  if (scale === null)
    delete (window as { visualViewport?: unknown }).visualViewport;
  else
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { scale },
    });
};

afterEach(() => {
  vi.useRealTimers();
  setScale(null);
  document.body.style.overflow = "";
});

describe("Lightbox mutants: useSwipe", () => {
  it("a drag whose click never arrives does not swallow the next tap", () => {
    const { onClose } = setup({ index: 4 });
    down(600, 300);
    move(640, 300); // past the slop: dragged
    up(640, 300); // no click follows (e.g. the target was removed)
    down(512, 300);
    up(512, 300);
    fireEvent.click(stage(), { clientX: 512, clientY: 300 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a press that starts pinch-zoomed is not a drag, even if the zoom ends", () => {
    const { onIndexChange } = setup({ index: 4 });
    setScale(2);
    down(300, 300);
    setScale(null);
    move(250, 300);
    expect(img().style.transform).toBe("");
    up(100, 300);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("a move from another pointer does not drag the first", () => {
    const { onIndexChange } = setup({ index: 4 });
    down(300, 300);
    move(200, 300, { pointerId: 2 });
    expect(img().style.transform).toBe("");
    up(100, 300, { pointerId: 2 });
    expect(onIndexChange).not.toHaveBeenCalled();
  });
});

describe("Lightbox mutants: usePreloadNeighbours", () => {
  const RealImage = globalThis.Image;
  let made: { src: string }[] = [];
  beforeEach(() => {
    made = [];
    class FakeImage {
      src = "";
      srcset = "";
      sizes = "";
      onload: unknown = null;
      onerror: unknown = null;
      constructor() {
        made.push(this);
      }
      removeAttribute() {}
    }
    globalThis.Image = FakeImage as unknown as typeof Image;
  });
  afterEach(() => {
    globalThis.Image = RealImage;
  });

  it("a new imgUrl function restarts the preload with the new URLs", () => {
    const a: ImgUrlFn = (id, variant) => `/a/${id}/${variant}`;
    const b: ImgUrlFn = (id, variant) => `/b/${id}/${variant}`;
    const ui = (fn: ImgUrlFn) => (
      <ImgUrlProvider value={fn}>
        <Lightbox
          photos={stable}
          index={3}
          t={t}
          onClose={() => {}}
          onIndexChange={() => {}}
        />
      </ImgUrlProvider>
    );
    const { rerender } = render(ui(a));
    expect(made.map((m) => m.src)).toEqual(["/a/p4/view-sm", "/a/p2/view-sm"]);
    rerender(ui(b));
    expect(made.slice(0, 2).map((m) => m.src)).toEqual(["", ""]);
    expect(made.slice(2).map((m) => m.src)).toEqual([
      "/b/p4/view-sm",
      "/b/p2/view-sm",
    ]);
  });
});

describe("Lightbox mutants: usePhotoImage", () => {
  it("the retry budget belongs to each photo", () => {
    render(<Nav />);
    fireEvent.error(img());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(img().getAttribute("src")).toBe("/img/p3/view-sm?r=1");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.error(img());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(img().getAttribute("src")).toBe("/img/p4/view-sm?r=1");
  });

  // Equivalent mutants, not tested: the currentId guard in onLoad/onError can
  // never matter. The <img> is keyed by photo id, so a previous photo's element
  // is unmounted and React never calls its handlers (checked by logging).

  it("a cached image is only detected by the ref for the photo already current", () => {
    const desc = Object.getOwnPropertyDescriptors(HTMLImageElement.prototype);
    Object.defineProperty(HTMLImageElement.prototype, "complete", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
      configurable: true,
      get: () => 100,
    });
    try {
      render(<Nav />);
      expect(img().className).toContain("opacity-100");
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      // The ref runs in the commit that switches photo, before the current id
      // is updated: it must not mark p4 loaded; its load event does.
      expect(img().className).toContain("opacity-0");
      fireEvent.load(img());
      expect(img().className).toContain("opacity-100");
    } finally {
      Object.defineProperty(
        HTMLImageElement.prototype,
        "complete",
        desc.complete ?? { value: false, configurable: true },
      );
      Object.defineProperty(
        HTMLImageElement.prototype,
        "naturalWidth",
        desc.naturalWidth ?? { value: 0, configurable: true },
      );
    }
  });
});

// Equivalent mutants, not tested:
// - key={photo.id} without the retry suffix: Retry only exists in the error
//   state, where no <img> is mounted, so the retried <img> is always new.
// - removing the shield's onContextMenu: the dialog root already prevents the
//   context menu when `protect` is on and the shield's event bubbles to it.
// - swapping useModalLock and useLightboxKeys: focus/scroll lock and the
//   document key listener do not interact; no event fires between the two
//   effects on mount or unmount.
describe("Lightbox mutants: PhotoStage", () => {
  it("the retried image is a new element", () => {
    setup();
    const first = img();
    fireEvent.error(first);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(img()).not.toBe(first);
  });

  it("the shield swallows the context menu", () => {
    setup({ protect: true });
    expect(fireEvent.contextMenu(screen.getByTestId("lightbox-shield"))).toBe(
      false,
    );
  });

  it("the image kept behind ignores the pointer", () => {
    render(<Nav />);
    fireEvent.load(img());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("lightbox-prev").className).toContain(
      "pointer-events-none",
    );
  });
});

describe("Lightbox mutants: useIdleChrome", () => {
  it("leaves no timer behind when unmounted while armed", () => {
    vi.useFakeTimers();
    const { unmount } = setup();
    fireEvent.pointerMove(dialog(), { pointerType: "mouse", clientX: 5 });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  // Key at t0, then the pointer takes over (not keyboard focus). Focus on a
  // control `gap` ms after the key counts as keyboard focus only if gap < 1000.
  const focusAfterKey = (gap: number) => {
    vi.useFakeTimers();
    setup({ onFavorite: () => {} });
    fireEvent.keyDown(dialog(), { key: "a" });
    fireEvent.pointerMove(dialog(), { pointerType: "mouse", clientX: 5 });
    act(() => {
      vi.advanceTimersByTime(gap);
    });
    const heart = screen.getByRole("button", { name: "Add to favorites" });
    act(() => heart.focus());
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    return dialog().getAttribute("data-controls");
  };

  it("focus 999 ms after a key press is keyboard focus: controls stay", () => {
    expect(focusAfterKey(999)).toBe("visible");
  });

  it("focus 1000 ms after a key press is not: controls hide", () => {
    expect(focusAfterKey(1000)).toBe("hidden");
  });

  it("focus 1001 ms after a key press is not: controls hide", () => {
    expect(focusAfterKey(1001)).toBe("hidden");
  });
});
