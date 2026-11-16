import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Lightbox } from "../../app/components/Lightbox";
import { photos, t } from "./fixtures";

function setup(
  props: Partial<React.ComponentProps<typeof Lightbox>> & {
    index?: number;
  } = {},
) {
  const onClose = vi.fn();
  const onIndexChange = vi.fn();
  const utils = render(
    <Lightbox
      photos={photos(10)}
      index={props.index ?? 3}
      t={t}
      onClose={onClose}
      onIndexChange={onIndexChange}
      {...props}
    />,
  );
  return { onClose, onIndexChange, ...utils };
}

describe("Lightbox", () => {
  it("is a modal dialog showing the current photo with srcset", () => {
    setup({ index: 3 });
    const dlg = screen.getByRole("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    const img = screen.getByTestId("lightbox-img");
    expect(img.getAttribute("srcset")).toBe(
      "/img/p3/view-sm 1200w, /img/p3/view-lg 2048w",
    );
    expect(img.getAttribute("sizes")).toBe("(min-width: 768px) 92vw, 100vw");
    expect(img.getAttribute("src")).toBe("/img/p3/view-sm");
    expect(img.getAttribute("alt")).toBe("Photo 4");
  });

  it("shows the counter via i18n", () => {
    setup({ index: 11, photos: photos(340) });
    expect(screen.getByText("12 / 340")).toBeTruthy();
  });

  it("ArrowRight/ArrowLeft navigate, Escape closes", async () => {
    const user = userEvent.setup();
    const { onIndexChange, onClose } = setup({ index: 3 });
    await user.keyboard("{ArrowRight}");
    expect(onIndexChange).toHaveBeenLastCalledWith(4);
    await user.keyboard("{ArrowLeft}");
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stops at the ends (no wrap) and disables buttons", async () => {
    const user = userEvent.setup();
    const first = setup({ index: 0 });
    await user.keyboard("{ArrowLeft}");
    expect(first.onIndexChange).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    first.unmount();
    const last = setup({ index: 9 });
    await user.keyboard("{ArrowRight}");
    expect(last.onIndexChange).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("prev/next/close buttons work", async () => {
    const user = userEvent.setup();
    const { onIndexChange, onClose } = setup({ index: 5 });
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onIndexChange).toHaveBeenLastCalledWith(6);
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(onIndexChange).toHaveBeenLastCalledWith(4);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("heart and download only when callbacks given", async () => {
    const user = userEvent.setup();
    const a = setup();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.queryByRole("button", { name: /favorites/i })).toBeNull();
    a.unmount();
    const onFavorite = vi.fn();
    const onDownload = vi.fn();
    setup({
      index: 2,
      onFavorite,
      onDownload,
      isFavorite: (id) => id === "p2",
    });
    await user.click(
      screen.getByRole("button", { name: "Remove from favorites" }),
    );
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(onFavorite).toHaveBeenCalledWith("p2");
    expect(onDownload).toHaveBeenCalledWith("p2");
  });

  it("swipe left goes next, swipe right goes previous", () => {
    const { onIndexChange } = setup({ index: 4 });
    const stage = screen.getByTestId("lightbox-stage");
    const swipe = (x0: number, x1: number, y1 = 200) => {
      fireEvent.pointerDown(stage, {
        pointerId: 1,
        pointerType: "touch",
        clientX: x0,
        clientY: 200,
      });
      fireEvent.pointerUp(stage, {
        pointerId: 1,
        pointerType: "touch",
        clientX: x1,
        clientY: y1,
      });
    };
    swipe(300, 200);
    expect(onIndexChange).toHaveBeenLastCalledWith(5);
    swipe(200, 300);
    expect(onIndexChange).toHaveBeenLastCalledWith(3);
  });

  it("short slow drags do not navigate", () => {
    vi.useFakeTimers();
    const { onIndexChange, onClose } = setup({ index: 4 });
    const stage = screen.getByTestId("lightbox-stage");
    fireEvent.pointerDown(stage, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 200,
      clientY: 200,
    });
    vi.advanceTimersByTime(1000);
    fireEvent.pointerUp(stage, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 170,
      clientY: 205,
    });
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("swipe down closes", () => {
    const { onClose, onIndexChange } = setup();
    const stage = screen.getByTestId("lightbox-stage");
    fireEvent.pointerDown(stage, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 200,
      clientY: 100,
    });
    fireEvent.pointerUp(stage, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 205,
      clientY: 260,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("swipe does not navigate past the ends", () => {
    const { onIndexChange } = setup({ index: 0 });
    const stage = screen.getByTestId("lightbox-stage");
    fireEvent.pointerDown(stage, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 200,
    });
    fireEvent.pointerUp(stage, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 300,
      clientY: 200,
    });
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  describe("preload", () => {
    const made: { src: string; srcset: string }[] = [];
    const RealImage = globalThis.Image;
    beforeEach(() => {
      made.length = 0;
      class FakeImage {
        _src = "";
        _srcset = "";
        sizes = "";
        set src(v: string) {
          this._src = v;
          made.push({ src: v, srcset: this._srcset });
        }
        get src() {
          return this._src;
        }
        set srcset(v: string) {
          this._srcset = v;
        }
        get srcset() {
          return this._srcset;
        }
      }
      globalThis.Image = FakeImage as unknown as typeof Image;
    });
    afterEach(() => {
      globalThis.Image = RealImage;
    });

    it("preloads next and previous photos", () => {
      setup({ index: 3 });
      const srcs = made.map((m) => m.src);
      expect(srcs).toContain("/img/p4/view-sm");
      expect(srcs).toContain("/img/p2/view-sm");
      expect(made.find((m) => m.src.includes("/p4/"))?.srcset).toContain(
        "/img/p4/view-lg 2048w",
      );
    });

    it("preloads only the existing neighbour at the ends", () => {
      setup({ index: 0 });
      const srcs = made.map((m) => m.src);
      expect(srcs).toContain("/img/p1/view-sm");
      expect(srcs.some((s) => s.includes("/img/p-1/"))).toBe(false);
      expect(srcs.some((s) => s.includes("undefined"))).toBe(false);
    });
  });

  describe("focus and scroll lock", () => {
    function Harness() {
      const [open, setOpen] = useState<number | null>(null);
      return (
        <>
          <button data-testid="trigger" onClick={() => setOpen(1)}>
            open
          </button>
          {open !== null && (
            <Lightbox
              photos={photos(4)}
              index={open}
              t={t}
              onClose={() => setOpen(null)}
              onIndexChange={setOpen}
            />
          )}
        </>
      );
    }

    it("moves focus in, traps Tab, restores focus and scroll on close", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      const trigger = screen.getByTestId("trigger");
      await user.click(trigger);
      const dlg = screen.getByRole("dialog");
      expect(dlg.contains(document.activeElement)).toBe(true);
      expect(document.body.style.overflow).toBe("hidden");
      for (let i = 0; i < 12; i++) {
        await user.tab();
        expect(dlg.contains(document.activeElement)).toBe(true);
      }
      for (let i = 0; i < 12; i++) {
        await user.tab({ shift: true });
        expect(dlg.contains(document.activeElement)).toBe(true);
      }
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(document.body.style.overflow).toBe("");
    });
  });

  describe("auto-hide controls", () => {
    it("hides after 2.5s idle on mouse, reappears on move", () => {
      vi.useFakeTimers();
      setup();
      const dlg = screen.getByRole("dialog");
      fireEvent.pointerMove(dlg, { pointerType: "mouse", clientX: 5 });
      expect(dlg.getAttribute("data-controls")).toBe("visible");
      act(() => {
        vi.advanceTimersByTime(2600);
      });
      expect(dlg.getAttribute("data-controls")).toBe("hidden");
      fireEvent.pointerMove(dlg, { pointerType: "mouse", clientX: 9 });
      expect(dlg.getAttribute("data-controls")).toBe("visible");
      vi.useRealTimers();
    });

    it("never hides on touch", () => {
      vi.useFakeTimers();
      setup();
      const dlg = screen.getByRole("dialog");
      fireEvent.pointerDown(screen.getByTestId("lightbox-stage"), {
        pointerType: "touch",
        pointerId: 1,
        clientX: 1,
        clientY: 1,
      });
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(dlg.getAttribute("data-controls")).toBe("visible");
      vi.useRealTimers();
    });
  });
});
