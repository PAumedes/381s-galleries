/**
 * T6.48 adversarial: behaviours moved into new hooks/components by the
 * refactor that NO characterization test pins (all snapshots are markup-only).
 * Each test passes on the pre-refactor code (34d294f) and on HEAD; it exists
 * to FAIL when the moved effect/handler is mutated (verified by mutation
 * runs), i.e. to prove the refactor's safety net has holes.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoverHero } from "../../app/components/CoverHero";
import { CoverPreview } from "../../app/components/admin/CoverPreview";
import { LivePreview } from "../../app/components/admin/LivePreview";
import {
  PhotoReorder,
  type ReorderPhoto,
} from "../../app/components/admin/PhotoReorder";
import { en } from "../../app/i18n/en";

vi.mock("../../app/components/Logo", () => ({ Logo: () => null }));

// ---------- fake ResizeObserver + element size -----------------------------
type FakeRO = {
  cb: () => void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};
let observers: FakeRO[] = [];
let dims = { w: 1000, h: 500 };
const realRO = globalThis.ResizeObserver;

beforeEach(() => {
  observers = [];
  dims = { w: 1000, h: 500 };
  class RO {
    cb: () => void;
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(cb: () => void) {
      this.cb = cb;
      observers.push(this as unknown as FakeRO);
    }
  }
  vi.stubGlobal("ResizeObserver", RO);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => dims.w,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => dims.h,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (realRO) globalThis.ResizeObserver = realRO;
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

const hero = (over: Record<string, unknown> = {}) => (
  <CoverHero
    title="T"
    date={null}
    studio="S"
    src="/d.jpg"
    proofing={false}
    focus={{ x: 75, y: 50 }}
    aspect={4}
    scrollLabel="go"
    {...over}
  />
);
const pos = () =>
  (document.querySelector("[data-cover-img]") as HTMLElement).style
    .objectPosition;

describe("CoverPhoto: frame measurement effect", () => {
  it("re-measures when the ResizeObserver fires and disconnects on unmount", () => {
    const { unmount } = render(hero());
    expect(pos()).toBe("100% 50%");
    dims = { w: 500, h: 1000 };
    act(() => observers.forEach((o) => o.cb()));
    expect(pos()).toMatch(/^78\.5\d+% 50%$/);
    const live = observers.filter((o) => o.observe.mock.calls.length);
    expect(live.length).toBeGreaterThan(0);
    unmount();
    for (const o of live) expect(o.disconnect).toHaveBeenCalled();
  });

  it("observes the NEW image node after the layout changes (effect deps)", () => {
    const { rerender } = render(hero({ layout: "completa" }));
    const first = observers.filter((o) => o.observe.mock.calls.length);
    rerender(hero({ layout: "centrada" }));
    const all = observers.filter((o) => o.observe.mock.calls.length);
    expect(all.length).toBe(first.length + 1);
    for (const o of first) expect(o.disconnect).toHaveBeenCalled();
    const lastNode = all[all.length - 1].observe.mock.calls[0][0];
    expect(lastNode).toBe(document.querySelector("[data-cover-img]"));
  });

  it("an unchanged measurement does not re-render (frame identity kept)", () => {
    render(hero());
    const spy = vi.spyOn(
      document.querySelector("[data-cover-img]") as HTMLElement,
      "clientWidth",
      "get",
    );
    act(() => observers.forEach((o) => o.cb()));
    expect(pos()).toBe("100% 50%");
    spy.mockRestore();
  });
});

describe("CoverPhoto: narrow-viewport effect", () => {
  function stubMatchMedia(initial: boolean) {
    const listeners = new Set<() => void>();
    const mq = {
      matches: initial,
      addEventListener: vi.fn((_: string, f: () => void) => listeners.add(f)),
      removeEventListener: vi.fn((_: string, f: () => void) =>
        listeners.delete(f),
      ),
    };
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mq),
    );
    window.matchMedia = vi.fn(() => mq) as unknown as typeof window.matchMedia;
    return { mq, listeners };
  }
  const MOBILE = { src: "/m.jpg", focus: null, aspect: 1.5 };
  const dev = () =>
    document
      .querySelector("[data-cover-img]")!
      .getAttribute("data-cover-device");

  it("follows the media query live and unsubscribes on unmount", () => {
    const { mq, listeners } = stubMatchMedia(true);
    const { unmount } = render(hero({ mobile: MOBILE }));
    expect(dev()).toBe("mobile");
    expect(listeners.size).toBe(1);
    mq.matches = false;
    act(() => listeners.forEach((f) => f()));
    expect(dev()).toBe("desktop");
    unmount();
    expect(mq.removeEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("does not touch matchMedia when a device is forced or there is no mobile cover", () => {
    const { mq } = stubMatchMedia(true);
    render(hero({ mobile: MOBILE, device: "desktop" }));
    expect(mq.addEventListener).not.toHaveBeenCalled();
    cleanupAll();
    render(hero());
    expect(mq.addEventListener).not.toHaveBeenCalled();
  });
});
function cleanupAll() {
  document.body.innerHTML = "";
}

// ---------- PhotoReorder keyboard / focus ----------------------------------
const photos: ReorderPhoto[] = [
  { id: "a", set: "S", name: "A", takenAt: null },
  { id: "b", set: "S", name: "B", takenAt: null },
  { id: "c", set: "S", name: "C", takenAt: null },
];
async function showReorder() {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => <PhotoReorder photos={photos} version="v1" />,
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
  await screen.findByRole("group", { name: "S" });
}
const btn = (id: string) =>
  document.querySelector(
    `[data-photo-id="${id}"] [role=button]`,
  ) as HTMLElement;
const order = () =>
  [...document.querySelectorAll("[data-photo-id]")].map((e) =>
    e.getAttribute("data-photo-id"),
  );
const key = (id: string, k: string) => fireEvent.keyDown(btn(id), { key: k });

describe("PhotoReorder keyboard (use-photo-order / keyToMove)", () => {
  it("Space selects, ArrowDown moves after, ArrowUp moves before", async () => {
    await showReorder();
    key("a", " ");
    expect(btn("a").getAttribute("aria-pressed")).toBe("true");
    key("a", "ArrowDown");
    expect(order()).toEqual(["b", "a", "c"]);
    key("a", "ArrowUp");
    expect(order()).toEqual(["a", "b", "c"]);
  });

  it("ArrowLeft / Home / End / ArrowRight each move the selected photo", async () => {
    await showReorder();
    key("b", "Enter");
    key("b", "ArrowLeft");
    expect(order()).toEqual(["b", "a", "c"]);
    key("b", "End");
    expect(order()).toEqual(["a", "c", "b"]);
    key("b", "Home");
    expect(order()).toEqual(["b", "a", "c"]);
    key("b", "ArrowRight");
    expect(order()).toEqual(["a", "b", "c"]);
  });

  it("keyboard focus follows the moved tile (new DOM position)", async () => {
    await showReorder();
    key("a", "Enter");
    key("a", "ArrowRight");
    expect(document.activeElement).toBe(btn("a"));
  });

  it("the toolbar buttons do NOT pull focus onto the tile", async () => {
    await showReorder();
    key("a", "Enter");
    fireEvent.click(screen.getByRole("button", { name: "Mover después" }));
    expect(order()).toEqual(["b", "a", "c"]);
    expect(document.activeElement).not.toBe(btn("a"));
  });

  it("Restablecer restores the order AND clears the selection", async () => {
    await showReorder();
    key("a", "Enter");
    key("a", "ArrowRight");
    fireEvent.click(screen.getByRole("button", { name: "Restablecer" }));
    expect(order()).toEqual(["a", "b", "c"]);
    expect(btn("a").getAttribute("aria-pressed")).toBe("false");
  });
});

// ---------- LivePreview fit scale -----------------------------------------
describe("PreviewFrame fit scale (useFitScale deps)", () => {
  it("re-fits immediately when the device (virtual viewport width) changes", async () => {
    dims = { w: 280, h: 200 };
    function Wrap() {
      const [d, setD] = useState<"desktop" | "mobile">("desktop");
      return (
        <>
          <button onClick={() => setD("mobile")}>to-mobile</button>
          <LivePreview
            title="T"
            eventDate={null}
            palette="claro"
            coverLayout="completa"
            proofing={false}
            cover={null}
            device={d}
            onDevice={setD}
          />
        </>
      );
    }
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        loader: () => ({ lang: "en", messages: en, studioName: "S" }),
        Component: Wrap,
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    const vp = async () =>
      (await screen.findByTestId("live-preview")).querySelector(
        "[data-viewport]",
      ) as HTMLElement;
    expect((await vp()).style.transform).toBe(`scale(${280 / 1280})`);
    // happy-dom: no real layout, the RO never fires; only the effect re-run
    // (deps [vp.w]) can pick the new viewport width up.
    fireEvent.click(screen.getByText("to-mobile"));
    expect((await vp()).style.transform).toBe(`scale(${280 / 390})`);
  });
});

// ---------- CoverPreview useSynced ----------------------------------------
describe("CoverPreview useSynced", () => {
  it("a server change of ONLY the vertical focal value replaces the local copy", async () => {
    function Wrap() {
      const [y, setY] = useState(20);
      return (
        <>
          <button onClick={() => setY(80)}>bump</button>
          <CoverPreview
            title="T"
            eventDate={null}
            palette="claro"
            coverLayout="completa"
            proofing={false}
            coverId="p1"
            coverWidth={3000}
            coverHeight={2000}
            initialFocus={{ x: 10, y }}
          />
        </>
      );
    }
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        loader: () => ({ lang: "en", messages: en, studioName: "S" }),
        Component: Wrap,
      },
    ]);
    const { container } = render(<Stub initialEntries={["/"]} />);
    await screen.findByText("bump");
    const fy = () =>
      (container.querySelector("input[name=focusY]") as HTMLInputElement).value;
    expect(fy()).toBe("20");
    fireEvent.click(screen.getByText("bump"));
    expect(fy()).toBe("80");
  });
});
