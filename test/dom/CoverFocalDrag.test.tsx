import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoverPreview } from "../../app/components/admin/CoverPreview";

const submitted: FormData[] = [];
function show() {
  const Stub = createRoutesStub([
    {
      path: "/",
      action: async ({ request }) => {
        submitted.push(await request.formData());
        return { ok: true, intent: "focus", message: "ok" };
      },
      Component: () => (
        <CoverPreview
          title="T"
          eventDate={null}
          palette="claro"
          coverLayout="completa"
          proofing={false}
          coverId="p1"
          coverWidth={200}
          coverHeight={100}
          initialFocus={null}
          device="desktop"
          onDevice={() => {}}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}
const picker = () => screen.findByTestId("focus-picker");
const marker = () => screen.getByTestId("focus-marker");
function size(el: HTMLElement) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 50,
    width: 200,
    height: 100,
    right: 300,
    bottom: 150,
    x: 100,
    y: 50,
    toJSON() {},
  });
}
const ptr = (type: string) => ({
  pointerId: 7,
  pointerType: type,
  isPrimary: true,
});

afterEach(() => {
  cleanup();
  submitted.length = 0;
});

describe("T6.35 focal point drag on touch", () => {
  it("the marker follows a finger moved without lifting, then saves on release", async () => {
    show();
    const el = await picker();
    size(el);
    el.setPointerCapture = vi.fn();
    el.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(el, { ...ptr("touch"), clientX: 150, clientY: 75 });
    expect(el.setPointerCapture).toHaveBeenCalledWith(7);
    expect(el.style.touchAction).toBe("none");
    expect(marker().style.left).toBe("25%");
    fireEvent.pointerMove(el, { ...ptr("touch"), clientX: 250, clientY: 125 });
    expect(marker().style.left).toBe("75%");
    expect(marker().style.top).toBe("75%");
    fireEvent.pointerMove(el, { ...ptr("touch"), clientX: 900, clientY: -40 });
    expect(marker().style.left).toBe("100%");
    expect(marker().style.top).toBe("0%");
    expect(submitted).toHaveLength(0);
    fireEvent.pointerUp(el, { ...ptr("touch"), clientX: 250, clientY: 125 });
    expect(el.style.touchAction).toBe("");
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
    const f = submitted[0]!;
    expect(f.get("intent")).toBe("focus");
    expect(f.get("device")).toBe("desktop");
    expect(f.get("focusX")).toBe("100");
    expect(f.get("focusY")).toBe("0");
  });

  it("moves after release or from another pointer do nothing", async () => {
    show();
    const el = await picker();
    size(el);
    fireEvent.pointerDown(el, { ...ptr("touch"), clientX: 150, clientY: 75 });
    fireEvent.pointerMove(el, {
      ...ptr("touch"),
      pointerId: 9,
      clientX: 250,
      clientY: 125,
    });
    expect(marker().style.left).toBe("25%");
    fireEvent.pointerUp(el, { ...ptr("touch"), clientX: 150, clientY: 75 });
    fireEvent.pointerMove(el, { ...ptr("touch"), clientX: 250, clientY: 125 });
    expect(marker().style.left).toBe("25%");
  });

  it("a cancelled gesture stops the drag and does not save", async () => {
    show();
    const el = await picker();
    size(el);
    fireEvent.pointerDown(el, { ...ptr("touch"), clientX: 150, clientY: 75 });
    fireEvent.pointerMove(el, { ...ptr("touch"), clientX: 250, clientY: 125 });
    fireEvent.pointerCancel(el, ptr("touch"));
    expect(el.style.touchAction).toBe("");
    fireEvent.pointerMove(el, { ...ptr("touch"), clientX: 110, clientY: 55 });
    expect(marker().style.left).toBe("75%");
    expect(submitted).toHaveLength(0);
  });

  it("losing pointer capture ends the drag, reverts the marker and does not save", async () => {
    show();
    const el = await picker();
    size(el);
    fireEvent.pointerDown(el, { ...ptr("touch"), clientX: 150, clientY: 75 });
    fireEvent.pointerMove(el, { ...ptr("touch"), clientX: 250, clientY: 125 });
    expect(marker().style.left).toBe("75%");
    fireEvent.lostPointerCapture(el, ptr("touch"));
    expect(marker().style.left).toBe("50%");
    expect(el.style.touchAction).toBe("");
    const ev = new Event("touchmove", { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    fireEvent.pointerUp(el, { ...ptr("touch"), clientX: 250, clientY: 125 });
    expect(submitted).toHaveLength(0);
  });

  it("the capture released after a normal release changes nothing", async () => {
    show();
    const el = await picker();
    size(el);
    fireEvent.pointerDown(el, { ...ptr("touch"), clientX: 150, clientY: 75 });
    fireEvent.pointerMove(el, { ...ptr("touch"), clientX: 250, clientY: 125 });
    fireEvent.pointerUp(el, { ...ptr("touch"), clientX: 250, clientY: 125 });
    fireEvent.lostPointerCapture(el, ptr("touch"));
    expect(marker().style.left).toBe("75%");
  });

  it("a plain tap sets the point but does not save (the button still does)", async () => {
    show();
    const el = await picker();
    size(el);
    fireEvent.pointerDown(el, { ...ptr("touch"), clientX: 150, clientY: 75 });
    fireEvent.pointerUp(el, { ...ptr("touch"), clientX: 150, clientY: 75 });
    fireEvent.click(el, { clientX: 150, clientY: 75 });
    expect(marker().style.left).toBe("25%");
    await new Promise((r) => setTimeout(r, 0));
    expect(submitted).toHaveLength(0);
  });

  it("mouse is unchanged: click sets, pointer events are ignored", async () => {
    show();
    const el = await picker();
    size(el);
    fireEvent.pointerDown(el, { ...ptr("mouse"), clientX: 150, clientY: 75 });
    expect(el.style.touchAction).toBe("");
    expect(marker().style.left).toBe("50%");
    fireEvent.click(el, { clientX: 250, clientY: 125 });
    expect(marker().style.left).toBe("75%");
  });

  it("keyboard arrows still move the point", async () => {
    show();
    const el = await picker();
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(marker().style.left).toBe("55%");
  });

  it("a non-passive touchmove on the photo is cancelled only while dragging", async () => {
    show();
    const el = await picker();
    size(el);
    const move = () => {
      const ev = new Event("touchmove", { bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(move()).toBe(false);
    fireEvent.pointerDown(el, { ...ptr("touch"), clientX: 150, clientY: 75 });
    expect(move()).toBe(true);
    fireEvent.pointerUp(el, { ...ptr("touch"), clientX: 150, clientY: 75 });
    expect(move()).toBe(false);
  });
});
