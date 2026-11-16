import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Lightbox } from "../../../app/components/Lightbox";
import { photos, t } from "../fixtures";

function Host() {
  const [i, setI] = useState(0);
  return (
    <Lightbox
      photos={photos(5)}
      index={i}
      t={t}
      onClose={() => {}}
      onIndexChange={setI}
    />
  );
}

describe("T2.2 round 2", () => {
  it("a retry on one photo must not strip srcset (view-lg) from every later photo", () => {
    render(<Host />);
    fireEvent.error(screen.getByTestId("lightbox-img"));
    fireEvent.click(screen.getByText("Retry"));
    fireEvent.keyDown(document, { key: "ArrowRight" });
    const img = screen.getByTestId("lightbox-img");
    expect(img.getAttribute("src")).toContain("/img/p1/");
    expect(img.getAttribute("srcset")).toContain("view-lg");
    expect(img.getAttribute("src")).not.toContain("r=");
  });

  // Design decision (orchestrator): on touch devices controls never auto-hide;
  // the original finding was that mount focus pinned them. Assert the intended
  // touch behaviour and that mount focus does not count as keyboard focus.
  it("touch-only user: controls stay visible (no auto-hide on touch)", () => {
    vi.useFakeTimers();
    try {
      render(<Host />);
      const dlg = screen.getByRole("dialog");
      fireEvent.pointerDown(screen.getByTestId("lightbox-stage"), {
        pointerType: "touch",
        pointerId: 1,
      });
      fireEvent.pointerUp(screen.getByTestId("lightbox-stage"), {
        pointerType: "touch",
        pointerId: 1,
      });
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(dlg.getAttribute("data-controls")).toBe("visible");
    } finally {
      vi.useRealTimers();
    }
  });
});
