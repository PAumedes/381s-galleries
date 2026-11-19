import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PhotoReorder,
  type ReorderPhoto,
} from "../../app/components/admin/PhotoReorder";
import { placeLook } from "../../app/components/admin/QuickLook";

const photos: ReorderPhoto[] = [1, 2].map((i) => ({
  id: `p${i}`,
  set: "Set",
  name: `n${i}`,
  takenAt: null,
}));
function show() {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      Component: () => (
        <PhotoReorder
          photos={photos}
          version="v1"
          coverPhotoId="p1"
          coverAuto
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin/g/g1"]} />);
}
const tile = (id: string) =>
  document.querySelector(`[data-photo-id="${id}"]`) as HTMLElement;
const frame = (id: string) =>
  tile(id).querySelector<HTMLElement>("[data-thumb-frame]")!;
const looks = () => document.querySelectorAll("[data-quick-look]");

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = ((q: string) => ({
    matches: q.includes("hover: hover"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
});
afterEach(() => vi.useRealTimers());

async function ready() {
  show();
  await screen.findByRole("group", { name: "Set" });
  vi.useFakeTimers();
}

describe("adversarial: photo-fit quick look", () => {
  it("clicking a hovered tile does not re-open the quick look via the focus that follows pointerdown", async () => {
    await ready();
    const btn = within(tile("p1")).getByRole("button", { name: "n1" });
    fireEvent.pointerEnter(frame("p1"));
    act(() => void vi.advanceTimersByTime(400));
    expect(looks()).toHaveLength(1);
    fireEvent.pointerDown(btn); // real browsers: pointerdown, then focus
    fireEvent.focus(btn);
    act(() => void vi.advanceTimersByTime(600));
    expect(looks()).toHaveLength(0);
  });

  it("closing the full viewer (focus restored to the tile button) does not pop the quick look", async () => {
    await ready();
    const view = within(tile("p1")).getByRole("button", {
      name: "Ver completa",
    });
    act(() => view.focus());
    fireEvent.click(view);
    act(() => void vi.advanceTimersByTime(10));
    fireEvent.keyDown(document, { key: "Escape" });
    act(() => void vi.advanceTimersByTime(800));
    expect(looks()).toHaveLength(0);
  });

  it("a view-sm that fails to load does not leave an empty bordered box", async () => {
    await ready();
    fireEvent.pointerEnter(frame("p1"));
    act(() => void vi.advanceTimersByTime(400));
    fireEvent.error(document.querySelector("[data-quick-look] img")!);
    expect(looks()).toHaveLength(0);
  });

  it("keeps an 8px margin from every viewport edge", () => {
    const r = placeLook(
      "a",
      { left: 900, right: 1000, top: 700, bottom: 760 },
      1024,
      768,
    );
    expect(r.left + r.width).toBeLessThanOrEqual(1024 - 8);
    expect(r.top + r.height).toBeLessThanOrEqual(768 - 8);
  });
});

describe("adversarial: photo-fit prefs", () => {
  it("follows changes made in another tab (storage event)", async () => {
    show();
    await screen.findByRole("group", { name: "Set" });
    act(() => {
      localStorage.setItem(
        "381.photoFit",
        JSON.stringify({ mode: "fill", size: "l" }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "381.photoFit",
          newValue: '{"mode":"fill","size":"l"}',
        }),
      );
    });
    expect(
      screen
        .getByRole("button", { name: "Rellenar" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
