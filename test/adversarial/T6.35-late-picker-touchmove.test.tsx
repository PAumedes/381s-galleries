import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoverPreview } from "../../app/components/admin/CoverPreview";

// The picker only exists when there is a cover photo. If the gallery starts
// with no photos and one arrives later (upload / cover chosen), the picker
// mounts after CoverPreview did. The touchmove-cancelling listener is
// attached in a `[]` effect, so it never reaches the late picker.
function Harness() {
  const [id, setId] = useState<string | null>(null);
  return (
    <>
      <button onClick={() => setId("p1")}>add</button>
      <CoverPreview
        title="T"
        eventDate={null}
        palette="claro"
        coverLayout="completa"
        proofing={false}
        coverId={id}
        coverWidth={200}
        coverHeight={100}
        initialFocus={null}
        device="desktop"
        onDevice={() => {}}
      />
    </>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("T6.35 touchmove cancel on a picker that mounts late", () => {
  it("cancels the browser pan while dragging even if the cover arrived after mount", async () => {
    const Stub = createRoutesStub([{ path: "/", Component: Harness }]);
    render(<Stub initialEntries={["/"]} />);
    await act(async () => {
      fireEvent.click(await screen.findByText("add"));
    });
    const el = await screen.findByTestId("focus-picker");
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    el.setPointerCapture = () => {};
    fireEvent.pointerDown(el, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });
    const ev = new Event("touchmove", { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
