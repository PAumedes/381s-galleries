import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Lightbox } from "../../app/components/Lightbox";
import { photos, t } from "./fixtures";

// T6.34: swipe-down close animation, slide between photos, touch edge taps,
// phone-sized controls. jsdom has no Element.animate / matchMedia: both are
// stubbed per test (no animate = instant behaviour, as before).

const stable = photos(10).map((p) => ({ ...p, v: "1" }));
let reduced = false;
const animations: { el: Element; frames: Keyframe[]; done: () => void }[] = [];

class FakeImage {
  sizes = "";
  srcset = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(v: string) {
    if (v) queueMicrotask(() => this.onload?.());
  }
  removeAttribute() {}
  decode() {
    return Promise.resolve();
  }
}
const RealImage = globalThis.Image;

function stubAnimate() {
  Element.prototype.animate = function (this: Element, frames: Keyframe[]) {
    let done!: () => void;
    const finished = new Promise<void>((r) => (done = r));
    animations.push({ el: this, frames, done });
    return { finished, cancel() {}, onfinish: null } as unknown as Animation;
  };
}
function stubMatchMedia() {
  window.matchMedia = ((q: string) => ({
    matches: q.includes("prefers-reduced-motion") ? reduced : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  reduced = false;
  animations.length = 0;
  stubMatchMedia();
  globalThis.Image = FakeImage as unknown as typeof Image;
});
afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
  globalThis.Image = RealImage;
});

function Harness({
  start = 3,
  onClose = () => {},
  onIndex,
}: {
  start?: number;
  onClose?: () => void;
  onIndex?: (i: number) => void;
}) {
  const [i, setI] = useState(start);
  return (
    <Lightbox
      photos={stable}
      index={i}
      t={t}
      onClose={onClose}
      onIndexChange={(n) => {
        onIndex?.(n);
        setI(n);
      }}
    />
  );
}

const stage = () => screen.getByTestId("lightbox-stage");
const img = () => screen.getByTestId("lightbox-img") as HTMLImageElement;
const backdrop = () =>
  document.querySelector("[data-lb-backdrop]") as HTMLElement;
const touch = { pointerId: 1, pointerType: "touch" };
const down = (x: number, y: number, el: Element = stage()) =>
  fireEvent.pointerDown(el, { ...touch, clientX: x, clientY: y });
const move = (x: number, y: number, el: Element = stage()) =>
  fireEvent.pointerMove(el, { ...touch, clientX: x, clientY: y });
const up = (x: number, y: number, el: Element = stage()) =>
  fireEvent.pointerUp(el, { ...touch, clientX: x, clientY: y });
const settle = () => act(async () => {});

describe("T6.34 swipe down", () => {
  it("the photo follows the finger down and the backdrop fades", () => {
    render(<Harness />);
    down(200, 100);
    move(200, 160);
    expect(img().style.transform).toMatch(/translateY\(60px\)/);
    expect(Number(backdrop().style.opacity)).toBeLessThan(1);
    expect(Number(backdrop().style.opacity)).toBeGreaterThan(0);
  });

  it("a short swipe springs back (transition on, transform cleared), no close", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    down(200, 100);
    move(200, 150);
    vi.setSystemTime(Date.now() + 500); // slow: not a flick
    up(200, 150);
    vi.useRealTimers();
    expect(img().style.transform).toBe("");
    expect(img().className).toContain("transition-[opacity,transform]");
    expect(backdrop().style.opacity).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a long swipe animates the photo out, then closes", async () => {
    stubAnimate();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    down(200, 100);
    move(200, 220);
    up(200, 220);
    expect(onClose).not.toHaveBeenCalled();
    const exits = animations.filter((a) =>
      JSON.stringify(a.frames).includes("translateY"),
    );
    expect(exits.length).toBeGreaterThan(0);
    expect(animations.some((a) => a.el === backdrop())).toBe(true);
    animations.forEach((a) => a.done());
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reduced motion closes at once, no animation", () => {
    stubAnimate();
    reduced = true;
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    down(200, 100);
    move(200, 220);
    up(200, 220);
    expect(animations).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("T6.34 slide between photos", () => {
  it("shows the preloaded neighbour next to the photo while dragging", async () => {
    render(<Harness />);
    await settle();
    down(300, 300);
    move(200, 300);
    const n = screen.getByTestId("lightbox-neighbour") as HTMLImageElement;
    expect(n.getAttribute("src")).toContain("p4");
    expect(n.style.transform).toBe(`translateX(${window.innerWidth - 100}px)`);
    move(400, 300);
    const p = screen.getByTestId("lightbox-neighbour");
    expect(p.getAttribute("src")).toContain("p2");
    expect(p.style.transform).toBe(`translateX(${100 - window.innerWidth}px)`);
  });

  it("T6.41: an unloaded neighbour is drawn as its thumbnail under the finger; none at the ends", async () => {
    render(<Harness start={0} />);
    down(300, 300);
    move(200, 300); // next not decoded yet (no microtask flush)
    const early = screen.getByTestId("lightbox-neighbour");
    expect(early.getAttribute("src")).toContain("/thumb");
    expect(early.getAttribute("srcset")).toBeNull();
    await settle();
    // Preloaded now: the full photo replaces the thumbnail.
    move(190, 300);
    expect(
      screen.getByTestId("lightbox-neighbour").getAttribute("src"),
    ).toContain("view-sm");
    move(400, 300); // towards the missing previous
    expect(screen.queryByTestId("lightbox-neighbour")).toBeNull();
  });

  it("arrow navigation slides: old photo out, new one in, then cleans up", async () => {
    stubAnimate();
    render(<Harness />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const leaving = screen.getByTestId("lightbox-leaving");
    expect(leaving.getAttribute("src")).toContain("p3");
    const W = window.innerWidth;
    const out = animations.find((a) => a.el === leaving)!;
    expect(JSON.stringify(out.frames)).toContain(`translateX(${-W}px)`);
    const inn = animations.find((a) => a.el === img())!;
    expect(JSON.stringify(inn.frames[0])).toContain(`translateX(${W}px)`);
    animations.forEach((a) => a.done());
    await settle();
    expect(screen.queryByTestId("lightbox-leaving")).toBeNull();
  });

  it("a swipe continues from where the finger let go", async () => {
    stubAnimate();
    render(<Harness />);
    await settle();
    down(300, 300);
    move(200, 300);
    up(200, 300);
    const W = window.innerWidth;
    const inn = animations.find((a) => a.el === img())!;
    expect(JSON.stringify(inn.frames[0])).toContain(`translateX(${W - 100}px)`);
    const out = animations.find(
      (a) => a.el === screen.getByTestId("lightbox-leaving"),
    )!;
    expect(JSON.stringify(out.frames[0])).toContain("translateX(-100px)");
  });

  it("T6.41: not preloaded: still slides, with the thumbnail as placeholder", () => {
    stubAnimate();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("lightbox-leaving")).toBeTruthy();
    const ph = screen.getByTestId("lightbox-placeholder");
    expect(ph.getAttribute("src")).toContain("/thumb");
    expect(animations.some((a) => a.el === ph)).toBe(true);
    expect(animations.some((a) => a.el === img())).toBe(true);
  });

  it("reduced motion: instant swap", async () => {
    stubAnimate();
    reduced = true;
    render(<Harness />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByTestId("lightbox-leaving")).toBeNull();
    expect(animations).toHaveLength(0);
    expect(img().getAttribute("src")).toContain("p4");
  });
});

describe("T6.34 touch edge taps", () => {
  // jsdom: innerWidth 1024 -> edges are x < 256 and x > 768.
  const tap = (x: number, y = 300, type = "touch") => {
    fireEvent.pointerDown(stage(), {
      pointerId: 1,
      pointerType: type,
      clientX: x,
      clientY: y,
    });
    fireEvent.pointerUp(stage(), {
      pointerId: 1,
      pointerType: type,
      clientX: x,
      clientY: y,
    });
    fireEvent.click(stage(), { clientX: x, clientY: y });
  };
  const setup = (start = 3) => {
    const onIndex = vi.fn();
    const onClose = vi.fn();
    render(<Harness start={start} onIndex={onIndex} onClose={onClose} />);
    return { onIndex, onClose };
  };

  it("tapping the left quarter goes previous, the right quarter next", () => {
    const { onIndex } = setup();
    tap(100);
    expect(onIndex).toHaveBeenLastCalledWith(2);
    tap(950);
    expect(onIndex).toHaveBeenLastCalledWith(3);
  });

  it("the tap can land on the photo itself", () => {
    const { onIndex } = setup();
    fireEvent.pointerDown(img(), { ...touch, clientX: 900, clientY: 300 });
    fireEvent.pointerUp(img(), { ...touch, clientX: 900, clientY: 300 });
    fireEvent.click(img(), { clientX: 900, clientY: 300 });
    expect(onIndex).toHaveBeenCalledWith(4);
  });

  it("the middle of the stage still closes on empty backdrop and never navigates", () => {
    const { onIndex, onClose } = setup();
    tap(512);
    expect(onIndex).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("first/last photo: the missing side does nothing (and does not close)", () => {
    const a = setup(0);
    tap(100);
    expect(a.onIndex).not.toHaveBeenCalled();
    expect(a.onClose).not.toHaveBeenCalled();
  });

  it("a drag is not a tap", () => {
    const { onIndex } = setup();
    down(900, 300);
    move(960, 300);
    up(960, 300);
    onIndex.mockClear();
    fireEvent.click(stage(), { clientX: 960, clientY: 300 });
    expect(onIndex).not.toHaveBeenCalled();
  });

  it("a mouse click on the stage edge keeps the old behaviour (zones, no nav)", () => {
    const { onIndex } = setup();
    tap(100, 300, "mouse");
    expect(onIndex).not.toHaveBeenCalled();
  });
});

describe("T6.34 phone-sized controls", () => {
  const cls = (el: Element | null) => el?.getAttribute("class") ?? "";
  it("top bar: 56px buttons, 32px icons, 18px counter, scrim", () => {
    render(
      <Lightbox
        photos={stable}
        index={1}
        t={t}
        onClose={() => {}}
        onIndexChange={() => {}}
        onFavorite={() => {}}
      />,
    );
    const close = screen.getByRole("button", { name: "Close" });
    expect(cls(close)).toContain("phone:size-14");
    expect(cls(close.querySelector("svg"))).toContain("phone:size-8");
    expect(cls(screen.getByText("2 / 10"))).toContain("phone:text-[1.125rem]");
    expect(document.querySelector("[data-lb-scrim]")).not.toBeNull();
  });

  it("side buttons are visible 56px chevrons on phones, hidden when disabled", () => {
    render(
      <Lightbox
        photos={stable}
        index={0}
        t={t}
        onClose={() => {}}
        onIndexChange={() => {}}
      />,
    );
    for (const name of ["Previous", "Next"]) {
      const b = screen.getByRole("button", { name });
      expect(cls(b)).not.toContain("pointer-coarse:sr-only");
      expect(cls(b)).toContain("phone:size-14");
      expect(cls(b)).toContain("phone:disabled:invisible");
    }
  });

  it("the swipe hint is only a label (the real chevrons are visible now)", () => {
    localStorage.clear();
    window.matchMedia = ((q: string) => ({
      matches: q.includes("pointer: coarse"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    render(<Harness />);
    expect(document.querySelector("[data-swipe-hint]")).not.toBeNull();
    expect(document.querySelector("[data-swipe-hint-chevron]")).toBeNull();
  });
});

describe("T6.51 closing guards", () => {
  const startExit = (y = 220) => {
    down(200, 100);
    move(200, y);
    up(200, y);
  };

  it("the exit animation starts from the distance the photo was pulled down", () => {
    stubAnimate();
    render(<Harness />);
    startExit(250); // pulled 150px
    const exit = animations.find((a) =>
      JSON.stringify(a.frames).includes("translateY"),
    )!;
    expect((exit.frames[0] as { transform: string }).transform).toMatch(
      /^translateY\(150px\)/,
    );
  });

  it("while the exit plays, Next / Previous and arrow keys do not navigate", async () => {
    stubAnimate();
    const onIndex = vi.fn();
    render(<Harness onIndex={onIndex} />);
    startExit();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(onIndex).not.toHaveBeenCalled();
    animations.forEach((a) => a.done());
    await settle();
  });

  it("without an exit running, the same controls navigate", () => {
    stubAnimate();
    const onIndex = vi.fn();
    render(<Harness onIndex={onIndex} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onIndex).toHaveBeenCalledWith(4);
  });
});
