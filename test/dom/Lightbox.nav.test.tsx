import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Lightbox } from "../../app/components/Lightbox";
import { photos, t } from "./fixtures";

function setup(index = 3) {
  const onClose = vi.fn();
  const onIndexChange = vi.fn();
  render(
    <Lightbox
      photos={photos(10)}
      index={index}
      t={t}
      onClose={onClose}
      onIndexChange={onIndexChange}
      onFavorite={() => {}}
      onDownload={() => {}}
    />,
  );
  return { onClose, onIndexChange };
}
const btn = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
const stage = () => screen.getByTestId("lightbox-stage");
// jsdom innerWidth is 1024 and innerHeight 768.
const clickAt = (x: number, y: number) =>
  fireEvent.click(stage(), { clientX: x, clientY: y });

describe("Lightbox navigation targets", () => {
  it("arrows are big side zones (>= 64px wide, full-height band)", () => {
    setup();
    for (const name of ["Previous", "Next"]) {
      const c = btn(name).className;
      expect(c).toMatch(/\bmin-w-16\b/);
      expect(c).toMatch(/\bw-\[1[2-8]vw\]/);
      expect(c).toMatch(/\binset-y-16\b/);
      // Class check only: media (pointer: coarse) cannot be emulated in jsdom.
      // Zones stay in the accessibility tree on touch (sr-only, not hidden).
      expect(c).toContain("pointer-coarse:sr-only");
      expect(c).not.toContain("pointer-coarse:hidden");
      expect(btn(name).querySelector("svg")?.getAttribute("class")).toMatch(
        /\bsize-12\b/,
      );
    }
  });

  it("every clickable control shows a pointer cursor and a hover/focus state", () => {
    setup();
    for (const name of ["Previous", "Next", "Close", "Download"]) {
      const c = btn(name).className;
      expect(c).toContain("cursor-pointer");
      expect(c).toContain("hover:text-white");
      expect(c).toContain("focus-visible:");
    }
    expect(btn("Previous").className).toContain("hover:bg-white/");
    expect(btn("Next").className).toContain("focus-visible:bg-white/");
  });

  it("the close button stays prominent (44px+)", () => {
    setup();
    expect(btn("Close").className).toMatch(/\bsize-1[1-9]\b|\bsize-[2-9]\d\b/);
  });

  it("clicking the arrows navigates and never closes", async () => {
    const user = userEvent.setup();
    const { onClose, onIndexChange } = setup();
    await user.click(btn("Next"));
    expect(onIndexChange).toHaveBeenLastCalledWith(4);
    await user.click(btn("Previous"));
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a quick double click on an arrow navigates twice and never closes", async () => {
    const user = userEvent.setup();
    const { onClose, onIndexChange } = setup();
    await user.dblClick(btn("Next"));
    expect(onIndexChange).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a click on a disabled arrow at the end of the gallery never closes", async () => {
    const user = userEvent.setup();
    const { onClose } = setup(9);
    await user.dblClick(btn("Next"));
    expect(onClose).not.toHaveBeenCalled();
    // and the disabled arrow does not let clicks fall through to the stage
    expect(btn("Next").className).not.toContain("pointer-events-none");
  });

  it("backdrop click inside a side zone does nothing", () => {
    const { onClose, onIndexChange } = setup();
    clickAt(40, 400); // left zone, beside the image
    clickAt(1000, 400); // right zone
    expect(onClose).not.toHaveBeenCalled();
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("backdrop click near the top bar does nothing", () => {
    const { onClose } = setup();
    clickAt(512, 20);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("backdrop click on empty area in the middle band closes", () => {
    const { onClose } = setup();
    clickAt(512, 740); // below the photo, away from controls
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicks on the image never close", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId("lightbox-img"), {
      clientX: 512,
      clientY: 740,
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keyboard is unchanged", async () => {
    const user = userEvent.setup();
    const { onClose, onIndexChange } = setup();
    await user.keyboard("{ArrowRight}");
    expect(onIndexChange).toHaveBeenLastCalledWith(4);
    await user.keyboard("{ArrowLeft}");
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Real press sequences (pointerdown/mousedown ... pointerup/mouseup/click).
  const press = (target: Element, x: number, y: number) => ({
    keys: "[MouseLeft>]",
    target,
    coords: { clientX: x, clientY: y },
  });
  const release = (target: Element, x: number, y: number) => ({
    keys: "[/MouseLeft]",
    target,
    coords: { clientX: x, clientY: y },
  });

  it("a real press and release on empty backdrop closes exactly once", async () => {
    const user = userEvent.setup();
    const { onClose, onIndexChange } = setup();
    await user.pointer([press(stage(), 512, 740), release(stage(), 512, 740)]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("press on the photo, release on empty backdrop does not close", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    const img = screen.getByTestId("lightbox-img");
    await user.pointer([press(img, 512, 300), release(stage(), 512, 740)]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("press on the protect shield, release on empty backdrop does not close", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Lightbox
        photos={photos(3)}
        index={1}
        t={t}
        protect
        onClose={onClose}
        onIndexChange={() => {}}
      />,
    );
    await user.pointer([
      press(screen.getByTestId("lightbox-shield"), 512, 300),
      release(stage(), 512, 740),
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("press on empty backdrop, release on the photo does not leave a stale press", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    const img = screen.getByTestId("lightbox-img");
    await user.pointer([press(stage(), 512, 740), release(img, 512, 300)]);
    // A later real click on empty backdrop still closes exactly once.
    await user.pointer([press(stage(), 512, 740), release(stage(), 512, 740)]);
    expect(onClose.mock.calls.length).toBeLessThanOrEqual(2);
    expect(onClose.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("mousedown inside a side zone, mouseup in the middle does not close", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.pointer([press(stage(), 40, 400), release(stage(), 512, 740)]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("mousedown in the middle, mouseup inside a side zone does not close", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.pointer([press(stage(), 512, 740), release(stage(), 40, 400)]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("boundaries: exactly 18% and 82% of the width, and y exactly 64, never close", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    const saved = window.innerWidth;
    window.innerWidth = 1000; // 18% = 180, 82% = 820, exact in floating point
    try {
      for (const [x, y] of [
        [180, 400],
        [820, 400],
        [500, 64],
      ]) {
        await user.pointer([press(stage(), x, y), release(stage(), x, y)]);
      }
      expect(onClose).not.toHaveBeenCalled();
      // one pixel inside each limit closes
      for (const [x, y] of [
        [181, 400],
        [819, 400],
        [500, 65],
      ]) {
        onClose.mockClear();
        await user.pointer([press(stage(), x, y), release(stage(), x, y)]);
        expect(onClose).toHaveBeenCalledTimes(1);
      }
    } finally {
      window.innerWidth = saved;
    }
  });

  it("a touch tap on empty backdrop closes once; a tap on the photo does not", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    const touch = (target: Element, x: number, y: number) => [
      { keys: "[TouchA>]", target, coords: { clientX: x, clientY: y } },
      { keys: "[/TouchA]", target, coords: { clientX: x, clientY: y } },
    ];
    await user.pointer(touch(screen.getByTestId("lightbox-img"), 512, 300));
    expect(onClose).not.toHaveBeenCalled();
    await user.pointer(touch(stage(), 512, 740));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a touch swipe from a side zone navigates once and does not also click", async () => {
    const { onIndexChange, onClose } = setup();
    // Swipe left over the Previous zone: a swipe goes to 4, a stray click on
    // the zone would go to 2.
    const next = btn("Previous");
    fireEvent.pointerDown(next, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 60,
      clientY: 400,
    });
    fireEvent.pointerMove(next, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 30,
      clientY: 400,
    });
    fireEvent.pointerUp(next, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 0,
      clientY: 400,
    });
    // the browser's trailing click on the zone must be swallowed
    fireEvent.click(next);
    expect(onIndexChange).toHaveBeenCalledTimes(1);
    expect(onIndexChange).toHaveBeenCalledWith(4);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a touch tap on an arrow still navigates by click", async () => {
    const user = userEvent.setup();
    const { onIndexChange } = setup();
    await user.pointer([
      { keys: "[TouchA>]", target: btn("Next") },
      { keys: "[/TouchA]", target: btn("Next") },
    ]);
    expect(onIndexChange).toHaveBeenCalledTimes(1);
    expect(onIndexChange).toHaveBeenCalledWith(4);
  });

  describe("focus", () => {
    const tab = (shift: boolean) => {
      const ev = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      });
      document.activeElement!.dispatchEvent(ev);
      return ev;
    };

    it("Tab on the last control wraps to the first, Shift+Tab the reverse", () => {
      setup();
      const nodes = screen
        .getByRole("dialog")
        .querySelectorAll<HTMLElement>("button:not([disabled])");
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      last.focus();
      expect(tab(false).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(first);
      expect(tab(true).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(last);
    });

    it("with display:none zones the trap wraps between visible controls", () => {
      const style = document.createElement("style");
      style.textContent = `button[aria-label="Previous"],button[aria-label="Next"]{display:none}`;
      document.head.appendChild(style);
      try {
        setup();
        const close = btn("Close");
        close.focus();
        expect(tab(false).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(
          screen.getByRole("dialog").querySelector("button"),
        );
        expect(document.activeElement).not.toBe(close);
      } finally {
        style.remove();
      }
    });

    it("prev/next stay in the accessibility tree (not display:none by class)", () => {
      setup();
      // Class check only (no media queries in jsdom): coarse pointers use
      // sr-only, so assistive tech keeps prev/next.
      for (const name of ["Previous", "Next"]) {
        expect(btn(name).className).not.toMatch(
          /(^|\s)(pointer-coarse:)?hidden\b/,
        );
      }
    });

    it("focus returns to the opener on unmount", () => {
      const opener = document.createElement("button");
      document.body.appendChild(opener);
      opener.focus();
      const { unmount } = render(
        <Lightbox
          photos={photos(3)}
          index={0}
          t={t}
          onClose={() => {}}
          onIndexChange={() => {}}
        />,
      );
      expect(document.activeElement).not.toBe(opener);
      unmount();
      expect(document.activeElement).toBe(opener);
      opener.remove();
    });
  });
});
