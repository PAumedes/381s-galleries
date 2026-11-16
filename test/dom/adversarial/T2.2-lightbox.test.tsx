import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Lightbox } from "../../../app/components/Lightbox";
import { Grid } from "../../../app/components/Grid";
import { renderToString } from "react-dom/server";
import { photos, t } from "../fixtures";

const mk = (over: Partial<React.ComponentProps<typeof Lightbox>> = {}) => {
  const onClose = vi.fn();
  const onIndexChange = vi.fn();
  const r = render(
    <Lightbox
      photos={photos(10)}
      index={3}
      t={t}
      onClose={onClose}
      onIndexChange={onIndexChange}
      {...over}
    />,
  );
  return { onClose, onIndexChange, ...r };
};

describe("Lightbox attacks", () => {
  it("pinch (second finger) must not trigger a swipe navigation", () => {
    const { onIndexChange, onClose } = mk();
    const stage = screen.getByTestId("lightbox-stage");
    const ev = { pointerType: "touch" };
    fireEvent.pointerDown(stage, {
      ...ev,
      pointerId: 1,
      clientX: 200,
      clientY: 300,
    });
    fireEvent.pointerDown(stage, {
      ...ev,
      pointerId: 2,
      clientX: 220,
      clientY: 300,
    });
    fireEvent.pointerMove(stage, {
      ...ev,
      pointerId: 1,
      clientX: 150,
      clientY: 300,
    });
    fireEvent.pointerMove(stage, {
      ...ev,
      pointerId: 2,
      clientX: 290,
      clientY: 300,
    });
    fireEvent.pointerUp(stage, {
      ...ev,
      pointerId: 2,
      clientX: 290,
      clientY: 300,
    });
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("out-of-range index must not leave body scroll locked with no UI", () => {
    const { onClose } = mk({ index: 50 });
    const visible = screen.queryByRole("dialog");
    expect(
      visible !== null ||
        onClose.mock.calls.length > 0 ||
        document.body.style.overflow !== "hidden",
    ).toBe(true);
  });

  it("modified arrow keys (Cmd/Alt+Left = browser back) are ignored", () => {
    const { onIndexChange } = mk();
    fireEvent.keyDown(document, { key: "ArrowLeft", metaKey: true });
    fireEvent.keyDown(document, { key: "ArrowRight", altKey: true });
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("hidden (auto-hidden) controls reappear when keyboard focus lands on them", () => {
    vi.useFakeTimers();
    try {
      mk();
      const dlg = screen.getByRole("dialog");
      fireEvent.pointerMove(dlg, { pointerType: "mouse" });
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(dlg.getAttribute("data-controls")).toBe("hidden");
      act(() => {
        screen.getByLabelText("Close").focus();
      });
      expect(dlg.getAttribute("data-controls")).toBe("visible");
    } finally {
      vi.useRealTimers();
    }
  });

  it("broken image shows an error state rather than a blank black stage", () => {
    mk();
    const img = screen.getByTestId("lightbox-img");
    fireEvent.error(img);
    expect(
      screen.queryByTestId("lightbox-error") ??
        screen.queryByRole("alert") ??
        screen.queryByRole("status"),
    ).not.toBeNull();
  });
});

describe("Grid attacks", () => {
  it("SSR without window APIs renders tiles", () => {
    const html = renderToString(
      <Grid photos={photos(5)} t={t} onOpen={() => {}} />,
    );
    expect(html).toContain("/img/p0/thumb");
  });

  it("disconnects ResizeObserver on unmount", () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect = disconnect;
        unobserve() {}
      },
    );
    const { unmount } = render(
      <Grid photos={photos(2)} t={t} onOpen={() => {}} />,
    );
    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
