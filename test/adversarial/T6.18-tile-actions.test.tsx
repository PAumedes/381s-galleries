import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PhotoReorder,
  type ReorderPhoto,
} from "../../app/components/admin/PhotoReorder";

const photos: ReorderPhoto[] = ["a", "b", "c"].map((id) => ({
  id,
  set: "Set",
  name: `IMG_${id}`,
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
          coverPhotoId="a"
          mobileCoverId="b"
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin/g/g1"]} />);
}
const tile = (id: string) =>
  document.querySelector(`[data-photo-id="${id}"]`) as HTMLElement;

describe("T6.18 adversarial", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as never;
  });
  afterEach(() => vi.useRealTimers());

  it("quick look must open from the picture only: entering the tile on the filename line must not open it", async () => {
    show();
    await screen.findAllByRole("listitem");
    // the li still has its own onPointerEnter (PhotoReorder.tsx li), so a pointer
    // entering the tile through the filename/gap starts the preview
    const filename = Array.from(tile("c").querySelectorAll("span")).find(
      (s) => s.textContent === "IMG_c",
    )!;
    fireEvent.pointerEnter(filename, { pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(600));
    expect(document.querySelectorAll("[data-quick-look]")).toHaveLength(0);
  });

  it("action buttons are not toggle buttons: 'Usar como portada' must not expose aria-pressed=false", async () => {
    show();
    await screen.findAllByRole("listitem");
    const bar = tile("c").querySelector("[data-tile-actions]") as HTMLElement;
    for (const name of ["Usar como portada", "Usar como portada móvil"]) {
      const b = within(bar).getByRole("button", { name });
      // a submit action announced as "toggle button, not pressed", whose name
      // flips to "Es la portada" when pressed, is a misleading ARIA pattern
      expect(b.hasAttribute("aria-pressed")).toBe(false);
    }
  });
});
