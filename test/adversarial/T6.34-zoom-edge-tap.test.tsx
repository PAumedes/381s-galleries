import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Lightbox } from "../../app/components/Lightbox";
import { photos, t } from "../dom/fixtures";

const stage = () => screen.getByTestId("lightbox-stage");
const touch = { pointerId: 1, pointerType: "touch" };

function setup(onClose = vi.fn()) {
  const onIndexChange = vi.fn();
  render(
    <Lightbox
      photos={photos(10)}
      index={4}
      t={t}
      onClose={onClose}
      onIndexChange={onIndexChange}
    />,
  );
  return { onClose, onIndexChange };
}
const tap = (x: number, y: number) => {
  fireEvent.pointerDown(stage(), { ...touch, clientX: x, clientY: y });
  fireEvent.pointerUp(stage(), { ...touch, clientX: x, clientY: y });
  fireEvent.click(stage(), { clientX: x, clientY: y });
};

afterEach(() => {
  delete (window as { visualViewport?: unknown }).visualViewport;
  delete (Element.prototype as { animate?: unknown }).animate;
});

describe("T6.34 adversarial", () => {
  it("a tap on the outer 25% while pinch-zoomed must NOT navigate (zoom disables edge taps)", () => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { scale: 2 },
    });
    const { onIndexChange } = setup();
    tap(50, 300); // inside the left 25% of a 1024px viewport
    tap(990, 300);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("Escape during the swipe-down exit animation closes once, not twice", async () => {
    const anims: (() => void)[] = [];
    (Element.prototype as unknown as { animate: unknown }).animate = () => {
      let done!: () => void;
      const finished = new Promise<void>((r) => (done = r));
      anims.push(done);
      return { finished } as unknown as Animation;
    };
    window.matchMedia = (() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    const { onClose } = setup();
    fireEvent.pointerDown(stage(), { ...touch, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(stage(), { ...touch, clientX: 200, clientY: 220 });
    fireEvent.pointerUp(stage(), { ...touch, clientX: 200, clientY: 220 });
    expect(anims.length).toBeGreaterThan(0);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    anims.forEach((d) => d());
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("arrow keys are ignored while the exit animation runs (no navigation mid-close)", async () => {
    const anims: (() => void)[] = [];
    (Element.prototype as unknown as { animate: unknown }).animate = () => {
      let done!: () => void;
      const finished = new Promise<void>((r) => (done = r));
      anims.push(done);
      return { finished } as unknown as Animation;
    };
    window.matchMedia = (() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    const { onIndexChange } = setup();
    fireEvent.pointerDown(stage(), { ...touch, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(stage(), { ...touch, clientX: 200, clientY: 220 });
    fireEvent.pointerUp(stage(), { ...touch, clientX: 200, clientY: 220 });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(onIndexChange).not.toHaveBeenCalled();
  });
});
