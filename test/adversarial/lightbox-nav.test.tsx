import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Lightbox } from "../../app/components/Lightbox";
import { photos, t } from "../dom/fixtures";

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

describe("lightbox-nav adversarial", () => {
  it("press on the photo and release on empty backdrop (drag) must not close", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    const img = screen.getByTestId("lightbox-img");
    const stage = screen.getByTestId("lightbox-stage");
    await user.pointer([
      {
        keys: "[MouseLeft>]",
        target: img,
        coords: { clientX: 512, clientY: 300 },
      },
      { target: stage, coords: { clientX: 512, clientY: 740 } },
      {
        keys: "[/MouseLeft]",
        target: stage,
        coords: { clientX: 512, clientY: 740 },
      },
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Tab trap ignores display:none zones (touch/keyboard devices): Tab on last visible control wraps", () => {
    const style = document.createElement("style");
    style.textContent = `button[aria-label="Previous"],button[aria-label="Next"]{display:none}`;
    document.head.appendChild(style);
    setup();
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();
    const ev = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.activeElement!.dispatchEvent(ev);
    // Close is the last *visible* control; focus must wrap, not escape.
    style.remove();
    expect(ev.defaultPrevented).toBe(true);
  });

  it("touch swipe that starts over a side zone navigates", () => {
    const { onIndexChange } = setup();
    const next = screen.getByRole("button", { name: "Next" });
    fireEvent.pointerDown(next, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 1000,
      clientY: 400,
    });
    fireEvent.pointerUp(next, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 800,
      clientY: 400,
    });
    expect(onIndexChange).toHaveBeenCalledWith(4);
  });
});
