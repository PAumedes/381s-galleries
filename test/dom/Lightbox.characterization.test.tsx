import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Lightbox } from "../../app/components/Lightbox";
import { ImgUrlProvider, adminImgUrl } from "../../app/components/img-url";
import { es } from "../../app/i18n/es";
import { makeT } from "../../app/i18n/t";
import { photos, t } from "./fixtures";

/**
 * Refactor guard for the Lightbox viewer: pins gesture thresholds, keyboard,
 * focus trap, idle chrome, retry, preload and DOM shape so the component can
 * be split into hooks/components without behaviour change.
 */

type Props = Partial<React.ComponentProps<typeof Lightbox>>;

function setup(props: Props = {}) {
  const onClose = vi.fn();
  const onIndexChange = vi.fn();
  const utils = render(
    <Lightbox
      photos={photos(10)}
      index={3}
      t={t}
      onClose={onClose}
      onIndexChange={onIndexChange}
      {...props}
    />,
  );
  return { onClose, onIndexChange, ...utils };
}

const stage = () => screen.getByTestId("lightbox-stage");
const dialog = () => screen.getByRole("dialog");
const img = () => screen.getByTestId("lightbox-img") as HTMLImageElement;
const touch = { pointerId: 1, pointerType: "touch" };
const down = (x: number, y: number, el: Element = stage(), extra = {}) =>
  fireEvent.pointerDown(el, { ...touch, clientX: x, clientY: y, ...extra });
const move = (x: number, y: number, el: Element = stage(), extra = {}) =>
  fireEvent.pointerMove(el, { ...touch, clientX: x, clientY: y, ...extra });
const up = (x: number, y: number, el: Element = stage(), extra = {}) =>
  fireEvent.pointerUp(el, { ...touch, clientX: x, clientY: y, ...extra });

/** Outer HTML with generated ids replaced by ordinals. */
function normalised(): string {
  const seen = new Map<string, string>();
  return document.body.innerHTML
    .replace(/(_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:)/g, (m) => {
      if (!seen.has(m)) seen.set(m, `ID${seen.size + 1}`);
      return seen.get(m)!;
    })
    .replace(/></g, ">\n<");
}

afterEach(() => {
  vi.useRealTimers();
  document.body.style.overflow = "";
});

describe("Lightbox characterization: swipe", () => {
  // Slow swipes: advance the clock so the velocity rule never applies.
  const slowSwipe = (dx: number, dy = 0) => {
    vi.useFakeTimers();
    const r = setup({ index: 4 });
    down(300, 300);
    vi.advanceTimersByTime(1000);
    up(300 + dx, 300 + dy);
    return r;
  };

  it("distance threshold is 50px: 49 does nothing, 50 navigates", () => {
    const a = slowSwipe(-49);
    expect(a.onIndexChange).not.toHaveBeenCalled();
    a.unmount();
    const b = slowSwipe(-50);
    expect(b.onIndexChange).toHaveBeenCalledWith(5);
    b.unmount();
    const c = slowSwipe(50);
    expect(c.onIndexChange).toHaveBeenCalledWith(3);
  });

  it("fast flick: >=20px and >0.5px/ms navigates; 19px does not", () => {
    vi.useFakeTimers();
    const a = setup({ index: 4 });
    down(300, 300);
    vi.advanceTimersByTime(20); // 25px / 20ms = 1.25
    up(275, 300);
    expect(a.onIndexChange).toHaveBeenCalledWith(5);
    a.unmount();
    const slow = setup({ index: 4 });
    down(300, 300);
    vi.advanceTimersByTime(40); // 25px / 40ms = 0.625, above 0.5
    up(275, 300);
    expect(slow.onIndexChange).toHaveBeenCalledWith(5);
    slow.unmount();
    const b = setup({ index: 4 });
    down(300, 300);
    vi.advanceTimersByTime(10);
    up(281, 300);
    expect(b.onIndexChange).not.toHaveBeenCalled();
    b.unmount();
    const c = setup({ index: 4 });
    down(300, 300);
    vi.advanceTimersByTime(100); // 25px / 100ms = 0.25 and < 50
    up(275, 300);
    expect(c.onIndexChange).not.toHaveBeenCalled();
  });

  it("vertical wins when |dy| >= |dx|: a long vertical swipe never navigates", () => {
    const a = slowSwipe(-60, 70);
    expect(a.onIndexChange).not.toHaveBeenCalled();
    expect(a.onClose).not.toHaveBeenCalled();
  });

  it("swipe down closes at 80px (slow) and not at 79", () => {
    const a = slowSwipe(0, 79);
    expect(a.onClose).not.toHaveBeenCalled();
    a.unmount();
    const b = slowSwipe(0, 80);
    expect(b.onClose).toHaveBeenCalledTimes(1);
    expect(b.onIndexChange).not.toHaveBeenCalled();
  });

  it("fast swipe down closes from 40px; swipe up never closes", () => {
    vi.useFakeTimers();
    const a = setup();
    down(300, 300);
    vi.advanceTimersByTime(20);
    up(300, 340);
    expect(a.onClose).toHaveBeenCalledTimes(1);
    a.unmount();
    const b = setup();
    down(300, 300);
    up(300, 100);
    expect(b.onClose).not.toHaveBeenCalled();
    expect(b.onIndexChange).not.toHaveBeenCalled();
  });

  it("mouse pointers never swipe", () => {
    const { onIndexChange, onClose } = setup({ index: 4 });
    down(300, 300, stage(), { pointerType: "mouse" });
    up(100, 300, stage(), { pointerType: "mouse" });
    down(300, 100, stage(), { pointerType: "mouse" });
    up(300, 400, stage(), { pointerType: "mouse" });
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("pointercancel aborts the gesture", () => {
    const { onIndexChange } = setup({ index: 4 });
    down(300, 300);
    fireEvent.pointerCancel(stage(), { ...touch, clientX: 100, clientY: 300 });
    up(100, 300);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("a second finger cancels the gesture, even after it lifts", () => {
    const { onIndexChange } = setup({ index: 4 });
    down(300, 300);
    down(310, 300, stage(), { pointerId: 2 });
    up(100, 300);
    up(100, 300, stage(), { pointerId: 2 });
    expect(onIndexChange).not.toHaveBeenCalled();
    // Both fingers are up: a fresh gesture works again.
    down(300, 300);
    up(100, 300);
    expect(onIndexChange).toHaveBeenCalledWith(5);
  });

  it("another pointer's move/up is ignored", () => {
    const { onIndexChange } = setup({ index: 4 });
    down(300, 300);
    up(100, 300, stage(), { pointerId: 9 });
    expect(onIndexChange).not.toHaveBeenCalled();
    up(100, 300);
    expect(onIndexChange).toHaveBeenCalledWith(5);
  });

  it("a pinch-zoomed viewport disables swipes (start and end)", () => {
    const orig = Object.getOwnPropertyDescriptor(window, "visualViewport");
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { scale: 2 },
    });
    try {
      const { onIndexChange } = setup({ index: 4 });
      down(300, 300);
      up(100, 300);
      expect(onIndexChange).not.toHaveBeenCalled();
    } finally {
      if (orig) Object.defineProperty(window, "visualViewport", orig);
      else delete (window as { visualViewport?: unknown }).visualViewport;
    }
  });

  it("zoom after the press still cancels the navigation on release", () => {
    const { onIndexChange } = setup({ index: 4 });
    down(300, 300);
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { scale: 1.5 },
    });
    try {
      up(100, 300);
    } finally {
      delete (window as { visualViewport?: unknown }).visualViewport;
    }
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("a swipe that starts on a control still navigates (listeners are on the dialog)", () => {
    const { onIndexChange } = setup({ index: 4, onFavorite: () => {} });
    const heart = screen.getByRole("button", { name: "Add to favorites" });
    down(300, 300, heart);
    up(100, 300, heart);
    expect(onIndexChange).toHaveBeenCalledWith(5);
  });

  it("drag: image follows the finger, rubber-bands at the ends, resets on release", () => {
    setup({ index: 0 });
    down(300, 300);
    move(340, 300); // past the slop, towards the (missing) previous
    expect(img().style.transform).toBe("translateX(10px)"); // 40 / 4
    move(250, 300); // towards next (exists)
    expect(img().style.transform).toBe("translateX(-50px)");
    move(250, 400); // vertical drag does not touch dragX
    expect(img().style.transform).toBe("translateX(-50px)");
    up(250, 300);
    expect(img().style.transform).toBe("");
  });

  it("drag rubber-band applies at the last photo too", () => {
    setup({ index: 9 });
    down(300, 300);
    move(200, 300);
    expect(img().style.transform).toBe("translateX(-25px)");
    move(400, 300);
    expect(img().style.transform).toBe("translateX(100px)");
  });

  it("a drag past the slop captures the pointer and swallows the trailing click once", () => {
    const { onClose } = setup({ index: 4 });
    const cap = vi.fn();
    (dialog() as unknown as { setPointerCapture: unknown }).setPointerCapture =
      cap;
    down(600, 300);
    move(605, 300);
    expect(cap).not.toHaveBeenCalled(); // within the 10px slop
    move(612, 300);
    expect(cap).toHaveBeenCalledTimes(1); // 12px > slop
    move(640, 300);
    expect(cap).toHaveBeenCalledTimes(1);
    up(640, 300);
    expect(fireEvent.click(stage(), { clientX: 512, clientY: 300 })).toBe(
      false,
    );
    expect(onClose).not.toHaveBeenCalled();
    // Only one click is swallowed.
    fireEvent.click(stage(), { clientX: 512, clientY: 300 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a plain tap (no drag) is not swallowed", () => {
    const { onClose } = setup({ index: 4 });
    down(512, 300);
    up(512, 300);
    fireEvent.click(stage(), { clientX: 512, clientY: 300 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Lightbox characterization: backdrop press origin", () => {
  it("synthetic click (no press seen) on empty backdrop closes", () => {
    const { onClose } = setup();
    fireEvent.click(stage(), { clientX: 512, clientY: 400 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("press on a side zone / release in the middle does not close; the stale press is cleared", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(stage(), { clientX: 50, clientY: 400 });
    fireEvent.click(stage(), { clientX: 512, clientY: 400 });
    expect(onClose).not.toHaveBeenCalled();
    // The press flag was consumed: a bare click closes again.
    fireEvent.click(stage(), { clientX: 512, clientY: 400 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pointerdown notes the press too", () => {
    const { onClose } = setup();
    down(50, 400, stage(), { pointerType: "mouse" });
    fireEvent.click(stage(), { clientX: 512, clientY: 400 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("press on the photo, release on empty backdrop does not close", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(img(), { clientX: 512, clientY: 400 });
    fireEvent.click(stage(), { clientX: 512, clientY: 400 });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Lightbox characterization: keyboard", () => {
  it("Escape closes and is default-prevented", () => {
    const { onClose } = setup();
    const ev = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("arrows navigate from the document; Home/End/other keys do nothing", () => {
    const { onIndexChange, onClose } = setup({ index: 5 });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(onIndexChange).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenLastCalledWith(6);
    onIndexChange.mockClear();
    for (const key of ["Home", "End", "ArrowUp", "ArrowDown", "a", " "])
      fireEvent.keyDown(document.body, { key });
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(["metaKey", "altKey", "ctrlKey", "shiftKey"])(
    "arrow with %s is ignored",
    (mod) => {
      const { onIndexChange } = setup();
      fireEvent.keyDown(document.body, { key: "ArrowRight", [mod]: true });
      fireEvent.keyDown(document.body, { key: "ArrowLeft", [mod]: true });
      expect(onIndexChange).not.toHaveBeenCalled();
    },
  );

  it("Escape with a modifier still closes", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document.body, { key: "Escape", shiftKey: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("another dialog above owns the keyboard (target or focused element)", () => {
    const { onIndexChange, onClose } = setup();
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    const input = document.createElement("button");
    other.appendChild(input);
    document.body.appendChild(other);
    try {
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.keyDown(input, { key: "ArrowRight" });
      expect(onClose).not.toHaveBeenCalled();
      expect(onIndexChange).not.toHaveBeenCalled();
      // Focus inside the other dialog, event aimed at the body.
      input.focus();
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
      // Events inside our own dialog are ours.
      fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), {
        key: "Escape",
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      other.remove();
    }
  });

  it("the keydown listener is removed on unmount", () => {
    const { onClose, unmount } = setup();
    unmount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses the latest onIndexChange/index after a re-render (no stale closure)", () => {
    function H() {
      const [i, setI] = useState(2);
      return (
        <Lightbox
          photos={photos(10)}
          index={i}
          t={t}
          onClose={() => {}}
          onIndexChange={setI}
        />
      );
    }
    render(<H />);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(screen.getByText("4 / 10")).toBeTruthy();
  });

  it("uses the latest onClose after a re-render", () => {
    const a = vi.fn();
    const b = vi.fn();
    const props = { photos: photos(3), index: 0, t, onIndexChange: () => {} };
    const { rerender } = render(<Lightbox {...props} onClose={a} />);
    rerender(<Lightbox {...props} onClose={b} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("Lightbox characterization: buttons and zones", () => {
  it("favourite toggle reflects isFavorite via aria-pressed and label", () => {
    const onFavorite = vi.fn();
    const { rerender } = setup({
      index: 2,
      onFavorite,
      isFavorite: () => false,
    });
    const add = screen.getByRole("button", { name: "Add to favorites" });
    expect(add.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(add);
    expect(onFavorite).toHaveBeenCalledWith("p2");
    rerender(
      <Lightbox
        photos={photos(10)}
        index={2}
        t={t}
        onClose={() => {}}
        onIndexChange={() => {}}
        onFavorite={onFavorite}
        isFavorite={(id) => id === "p2"}
      />,
    );
    const rm = screen.getByRole("button", { name: "Remove from favorites" });
    expect(rm.getAttribute("aria-pressed")).toBe("true");
  });

  it("favourite without isFavorite is unpressed; download without favourite is alone", () => {
    const onDownload = vi.fn();
    setup({ onDownload });
    expect(screen.queryByRole("button", { name: /favorites/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(onDownload).toHaveBeenCalledWith("p3");
  });

  it("only close is present with no callbacks; button order is fav, download, close", () => {
    const a = setup();
    expect(
      screen.getAllByRole("button").map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Close", "Previous", "Next"]);
    a.unmount();
    setup({ onFavorite: () => {}, onDownload: () => {} });
    expect(
      screen.getAllByRole("button").map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Add to favorites", "Download", "Close", "Previous", "Next"]);
  });

  it("the close button is focused on mount and calls onClose", () => {
    const { onClose } = setup();
    const close = screen.getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("side zones navigate, disable at the ends, keep disabled-state classes", () => {
    const a = setup({ index: 0 });
    const prev = screen.getByRole("button", {
      name: "Previous",
    }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(prev.className).toContain("left-0");
    fireEvent.click(prev);
    expect(a.onIndexChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(a.onIndexChange).toHaveBeenCalledWith(1);
    expect(screen.getByRole("button", { name: "Next" }).className).toContain(
      "right-0",
    );
  });

  it("a single photo disables both zones", () => {
    setup({ photos: photos(1), index: 0 });
    for (const name of ["Previous", "Next"])
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    expect(screen.getByText("1 / 1")).toBeTruthy();
  });

  it("index is clamped and truncated; NaN opens the first photo", () => {
    const a = setup({ index: 99 });
    expect(screen.getByText("10 / 10")).toBeTruthy();
    a.unmount();
    const b = setup({ index: -4 });
    expect(screen.getByText("1 / 10")).toBeTruthy();
    b.unmount();
    const c = setup({ index: 2.9 });
    expect(screen.getByText("3 / 10")).toBeTruthy();
    c.unmount();
    setup({ index: Number.NaN });
    expect(screen.getByText("1 / 10")).toBeTruthy();
  });

  it("empty photos render nothing, call onClose once and do not lock scroll", () => {
    const { onClose, container } = setup({ photos: [] });
    expect(container.innerHTML).toBe("");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe("");
  });

  it("dialog semantics and Spanish strings", () => {
    setup({
      t: makeT("es", es),
      onFavorite: () => {},
      onDownload: () => {},
      index: 1,
    });
    const d = dialog();
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(d.getAttribute("aria-label")).toBe("Foto 2");
    expect(d.getAttribute("tabindex")).toBe("-1");
    expect(d.getAttribute("data-theme")).toBe("oscuro");
    for (const name of [
      "Agregar a favoritas",
      "Descargar",
      "Cerrar",
      "Anterior",
      "Siguiente",
    ])
      expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getByText("2 / 10")).toBeTruthy();
    expect(img().getAttribute("alt")).toBe("Foto 2");
  });
});

describe("Lightbox characterization: focus trap and scroll lock", () => {
  const tab = (shift: boolean, target: Element = document.activeElement!) => {
    const ev = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(ev);
    return ev;
  };

  it("Tab from outside the dialog pulls focus to the first control", () => {
    setup({ onFavorite: () => {} });
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const ev = tab(false, document.body);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add to favorites" }),
    );
    outside.remove();
  });

  it("Tab in the middle is left to the browser", () => {
    setup({ onFavorite: () => {} });
    screen.getByRole("button", { name: "Add to favorites" }).focus();
    expect(tab(false).defaultPrevented).toBe(false);
    expect(tab(true).defaultPrevented).toBe(true); // first + Shift wraps
  });

  it("disabled zones are skipped: at the first photo Close is not last when Next exists, Previous is out", () => {
    setup({ index: 0 });
    // Order: Close, (Previous disabled), Next. Last = Next.
    const next = screen.getByRole("button", { name: "Next" });
    next.focus();
    expect(tab(false).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close" }),
    );
    // Single photo: Close is both first and last.
  });

  it("a single focusable (only Close) wraps onto itself", () => {
    setup({ photos: photos(1), index: 0 });
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();
    expect(tab(false).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    expect(tab(true).defaultPrevented).toBe(true);
  });

  it("visibility:hidden ancestors/controls are skipped by the trap", () => {
    const style = document.createElement("style");
    style.textContent = `button[aria-label="Next"]{visibility:hidden}`;
    document.head.appendChild(style);
    try {
      setup();
      const close = screen.getByRole("button", { name: "Close" });
      const prev = screen.getByRole("button", { name: "Previous" });
      prev.focus();
      expect(tab(false).defaultPrevented).toBe(true); // Previous is last now
      expect(document.activeElement).toBe(close);
    } finally {
      style.remove();
    }
  });

  it("locks body scroll, restores the previous value and the opener's focus", () => {
    document.body.style.overflow = "scroll";
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = setup();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("scroll");
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("does not restore focus to a disconnected opener or the body", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const focusSpy = vi.spyOn(opener, "focus");
    const a = setup();
    focusSpy.mockClear();
    opener.remove();
    expect(() => a.unmount()).not.toThrow();
    expect(focusSpy).not.toHaveBeenCalled();
    (document.activeElement as HTMLElement | null)?.blur();
    const b = setup();
    b.unmount();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("Lightbox characterization: idle chrome", () => {
  beforeEach(() => vi.useFakeTimers());
  const mouseMove = () =>
    fireEvent.pointerMove(dialog(), { pointerType: "mouse", clientX: 5 });
  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  const controls = () => dialog().getAttribute("data-controls");

  it("hides at exactly 2500ms of mouse idleness and not before; hidden state class", () => {
    setup();
    mouseMove();
    advance(2499);
    expect(controls()).toBe("visible");
    advance(1);
    expect(controls()).toBe("hidden");
    expect(dialog().className).toContain("cursor-none");
    expect(screen.getByText("4 / 10").parentElement!.className).toContain(
      "pointer-events-none opacity-0",
    );
  });

  it("a new mouse move re-arms the timer", () => {
    setup();
    mouseMove();
    advance(2000);
    mouseMove();
    advance(2000);
    expect(controls()).toBe("visible");
    advance(500);
    expect(controls()).toBe("hidden");
  });

  it("touch and pen moves do not arm the timer", () => {
    setup();
    fireEvent.pointerMove(dialog(), { pointerType: "pen", clientX: 5 });
    advance(10000);
    expect(controls()).toBe("visible");
  });

  it("hiding parks focus on the dialog when it was inside it", () => {
    setup();
    mouseMove();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close" }),
    );
    advance(2500);
    expect(document.activeElement).toBe(dialog());
  });

  it("keyboard focus keeps the controls visible, re-checking every 2.5s", () => {
    setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), {
      key: "Shift",
    });
    advance(10000);
    expect(controls()).toBe("visible");
    // A mouse move ends keyboard mode; the next idle period hides.
    mouseMove();
    advance(2500);
    expect(controls()).toBe("hidden");
  });

  it("focus landing while hidden (keyboard) reveals the controls", () => {
    setup();
    mouseMove();
    advance(2500);
    expect(controls()).toBe("hidden");
    act(() => screen.getByRole("button", { name: "Next" }).focus());
    expect(controls()).toBe("visible");
  });

  it("focus right after a key press counts as keyboard focus; a late focus does not", () => {
    setup();
    mouseMove();
    // Key press then focus within 1s: keyboard mode pins controls.
    fireEvent.keyDown(dialog(), { key: "x" });
    mouseMove(); // clears keyboard mode, re-arms
    act(() => screen.getByRole("button", { name: "Next" }).focus());
    // Visible, and lastKeyAt < 1s ago: keyboard focus is set again.
    advance(10000);
    expect(controls()).toBe("visible");
    act(() => screen.getByRole("button", { name: "Previous" }).focus());
    mouseMove();
    advance(1500); // 1.5s after the key press
    act(() => screen.getByRole("button", { name: "Close" }).focus());
    advance(2500);
    expect(controls()).toBe("hidden");
  });

  it("the idle timer is cleared on unmount", () => {
    const { unmount } = setup();
    mouseMove();
    unmount();
    expect(() => advance(5000)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Lightbox characterization: image states", () => {
  it("initial image is hidden until loaded; load shows it", () => {
    setup();
    expect(img().className).toContain("opacity-0");
    fireEvent.load(img());
    expect(img().className).toContain("opacity-100");
  });

  it("error shows status + retry; retry remounts with ?r=n and no srcset", () => {
    setup();
    fireEvent.error(img());
    const err = screen.getByTestId("lightbox-error");
    expect(err.getAttribute("role")).toBe("status");
    expect(screen.queryByTestId("lightbox-img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(img().getAttribute("src")).toBe("/img/p3/view-sm?r=1");
    expect(img().hasAttribute("srcset")).toBe(false);
    fireEvent.error(img());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(img().getAttribute("src")).toBe("/img/p3/view-sm?r=2");
  });

  it("retry on a versioned url appends with &", () => {
    const ps = photos(5).map((p) => ({ ...p, v: "abc" }));
    setup({ photos: ps });
    fireEvent.error(img());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(img().getAttribute("src")).toContain("&r=1");
  });

  it("retry counter is per photo", () => {
    function H() {
      const [i, setI] = useState(3);
      return (
        <Lightbox
          photos={photos(10)}
          index={i}
          t={t}
          onClose={() => {}}
          onIndexChange={setI}
        />
      );
    }
    render(<H />);
    fireEvent.error(img());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(img().getAttribute("src")).toBe("/img/p4/view-sm");
    expect(img().getAttribute("srcset")).toContain("view-lg");
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(img().getAttribute("src")).toBe("/img/p3/view-sm?r=1");
  });

  it("an already-complete cached image counts as loaded on mount", () => {
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
      setup();
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

  it("while the next photo loads the last loaded one stays behind (aria-hidden, empty alt)", () => {
    function H() {
      const [i, setI] = useState(3);
      return (
        <Lightbox
          photos={photos(10)}
          index={i}
          t={t}
          onClose={() => {}}
          onIndexChange={setI}
        />
      );
    }
    render(<H />);
    expect(screen.queryByTestId("lightbox-prev")).toBeNull();
    fireEvent.load(img());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const behind = screen.getByTestId("lightbox-prev");
    expect(behind.getAttribute("src")).toBe("/img/p3/view-sm");
    expect(behind.getAttribute("alt")).toBe("");
    expect(behind.getAttribute("aria-hidden")).toBe("true");
    expect(behind.getAttribute("srcset")).toContain("2048w");
    fireEvent.error(img());
    expect(screen.queryByTestId("lightbox-prev")).toBeNull();
  });

  it("admin image url (no view-lg) gives a single srcset candidate", () => {
    render(
      <ImgUrlProvider value={adminImgUrl(false)}>
        <Lightbox
          photos={photos(5)}
          index={1}
          t={t}
          onClose={() => {}}
          onIndexChange={() => {}}
        />
      </ImgUrlProvider>,
    );
    expect(img().getAttribute("src")).toBe("/admin/img/p1/view-sm");
    expect(img().getAttribute("srcset")).toBe("/admin/img/p1/view-sm 1200w");
  });
});

describe("Lightbox characterization: proofing", () => {
  it("watermarked admin variants for the image, the layer behind and no download", () => {
    function H() {
      const [i, setI] = useState(1);
      return (
        <ImgUrlProvider value={adminImgUrl(true)}>
          <Lightbox
            photos={photos(5)}
            index={i}
            t={t}
            onClose={() => {}}
            onIndexChange={setI}
            protect
          />
        </ImgUrlProvider>
      );
    }
    render(<H />);
    expect(img().getAttribute("src")).toBe("/admin/img/p1/view-sm-wm");
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    fireEvent.load(img());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("lightbox-prev").getAttribute("src")).toBe(
      "/admin/img/p1/view-sm-wm",
    );
  });

  it("protect: dialog context menu is prevented, class set, shield follows the drag", () => {
    setup({ protect: true });
    expect(dialog().className).toContain("img-protect");
    expect(fireEvent.contextMenu(dialog())).toBe(false);
    const shield = screen.getByTestId("lightbox-shield");
    expect(shield.getAttribute("aria-hidden")).toBe("true");
    down(300, 300);
    move(340, 300);
    expect(shield.style.transform).toBe("translateX(40px)");
  });

  it("no protect: context menu is untouched", () => {
    setup();
    expect(dialog().className).not.toContain("img-protect");
    expect(fireEvent.contextMenu(dialog())).toBe(true);
  });

  it("the shield is not rendered in the error state", () => {
    setup({ protect: true });
    fireEvent.error(img());
    expect(screen.queryByTestId("lightbox-shield")).toBeNull();
  });
});

describe("Lightbox characterization: preload", () => {
  const RealImage = globalThis.Image;
  type Fake = {
    src: string;
    srcset: string;
    sizes: string;
    onload: unknown;
    onerror: unknown;
    removed: string[];
  };
  let made: Fake[] = [];
  beforeEach(() => {
    made = [];
    class FakeImage {
      src = "";
      srcset = "";
      sizes = "";
      onload: unknown = () => {};
      onerror: unknown = () => {};
      removed: string[] = [];
      constructor() {
        made.push(this as unknown as Fake);
      }
      removeAttribute(n: string) {
        this.removed.push(n);
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;
  });
  afterEach(() => {
    globalThis.Image = RealImage;
  });

  it("next first, then previous, with sizes, srcset and view-sm src", () => {
    setup({ index: 3 });
    expect(made.map((m) => m.src)).toEqual([
      "/img/p4/view-sm",
      "/img/p2/view-sm",
    ]);
    expect(made[0].sizes).toBe("(min-width: 768px) 92vw, 100vw");
    expect(made[0].srcset).toBe("/img/p4/view-sm 1200w, /img/p4/view-lg 2048w");
  });

  it("cleanup cancels in-flight preloads on navigation and unmount; re-runs per index only", () => {
    const stable = photos(10);
    function H() {
      const [i, setI] = useState(3);
      return (
        <Lightbox
          photos={stable}
          index={i}
          t={t}
          onClose={() => {}}
          onIndexChange={setI}
        />
      );
    }
    const { unmount } = render(<H />);
    expect(made).toHaveLength(2);
    const first = [...made];
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(made).toHaveLength(4);
    for (const m of first) {
      expect(m.src).toBe("");
      expect(m.onload).toBeNull();
      expect(m.onerror).toBeNull();
      expect(m.removed).toEqual(["srcset"]);
    }
    // Unrelated re-render (favourite state etc.) does not preload again.
    fireEvent.pointerMove(dialog(), { pointerType: "mouse", clientX: 3 });
    expect(made).toHaveLength(4);
    const live = made.slice(2);
    unmount();
    for (const m of live) expect(m.src).toBe("");
  });

  it("a finished preload is no longer cancelled on cleanup", () => {
    const { unmount } = setup({ index: 3 });
    const m = made[0];
    (m.onload as () => void)();
    (made[1].onerror as () => void)();
    unmount();
    expect(m.src).toBe("/img/p4/view-sm");
    expect(made[1].src).toBe("/img/p2/view-sm");
  });
});

describe("Lightbox characterization: DOM snapshots", () => {
  it("default, first photo, no callbacks", () => {
    setup({ index: 0 });
    expect(normalised()).toMatchSnapshot();
  });

  it("with favourite + download, middle photo, loaded", () => {
    setup({
      index: 4,
      onFavorite: () => {},
      onDownload: () => {},
      isFavorite: () => true,
    });
    fireEvent.load(img());
    expect(normalised()).toMatchSnapshot();
  });

  it("proofing (protect) at the last photo", () => {
    setup({ index: 9, protect: true });
    expect(normalised()).toMatchSnapshot();
  });

  it("error state", () => {
    setup({ index: 2 });
    fireEvent.error(img());
    expect(normalised()).toMatchSnapshot();
  });

  it("controls hidden, mid-drag", () => {
    vi.useFakeTimers();
    setup({ index: 2 });
    fireEvent.pointerMove(dialog(), { pointerType: "mouse", clientX: 5 });
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    down(300, 300);
    move(350, 300);
    expect(normalised()).toMatchSnapshot();
  });

  it("Spanish", () => {
    setup({
      index: 1,
      t: makeT("es", es),
      onFavorite: () => {},
      onDownload: () => {},
    });
    expect(normalised()).toMatchSnapshot();
  });
});
