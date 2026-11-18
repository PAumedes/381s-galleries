import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PhotoReorder,
  type ReorderPhoto,
} from "../../app/components/admin/PhotoReorder";

const KINDS = ["vertical", "horizontal 3:2", "square", "panorama"];
const photos: ReorderPhoto[] = KINDS.map((name, i) => ({
  id: `p${i + 1}`,
  set: "Set",
  name,
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
  tile(id).querySelector("[data-thumb-frame]") as HTMLElement;
const img = (id: string) => tile(id).querySelector("img") as HTMLImageElement;
const grid = () => document.querySelector("ul[data-set]") as HTMLElement;
const lookImgs = () =>
  Array.from(document.querySelectorAll("img")).filter((i) =>
    i.getAttribute("src")?.endsWith("/view-sm"),
  );

function media(fine: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: q.includes("hover: hover") ? fine : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  media(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Fotos: fit by default", () => {
  it("shows every photo whole (object-contain, 4:3 box, neutral background) from the thumb variant", async () => {
    show();
    await screen.findByRole("group", { name: "Set" });
    for (const id of ["p1", "p2", "p3", "p4"]) {
      expect(img(id).getAttribute("src")).toBe(`/admin/img/${id}/thumb`);
      expect(img(id).className).toMatch(/object-contain/);
      expect(img(id).className).not.toMatch(/object-cover/);
      expect(frame(id).className).toMatch(/aspect-\[4\/3\]/);
      expect(frame(id).className).not.toMatch(/aspect-square/);
      expect(frame(id).className).toMatch(/bg-grey-100/);
      expect(img(id).getAttribute("loading")).toBe("lazy");
      expect(img(id).getAttribute("decoding")).toBe("async");
    }
  });

  it("'Rellenar' brings back the square cropped tile; 'Ajustar' returns", async () => {
    show();
    await screen.findByRole("group", { name: "Set" });
    const fit = screen.getByRole("button", { name: "Ajustar" });
    const fill = screen.getByRole("button", { name: "Rellenar" });
    expect(fit.getAttribute("aria-pressed")).toBe("true");
    expect(fill.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(fill);
    expect(img("p2").className).toMatch(/object-cover/);
    expect(frame("p2").className).toMatch(/aspect-square/);
    expect(fill.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(fit);
    expect(img("p2").className).toMatch(/object-contain/);
  });

  it("S/M/L change the grid; M is the default and L is bigger than S", async () => {
    show();
    await screen.findByRole("group", { name: "Set" });
    const m = grid().className;
    expect(
      screen
        .getByRole("button", { name: "Mediano" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Pequeño" }));
    const s = grid().className;
    await userEvent.click(screen.getByRole("button", { name: "Grande" }));
    const l = grid().className;
    expect(new Set([s, m, l]).size).toBe(3);
    const min = (c: string) => Number(/minmax\((\d+(?:\.\d+)?)rem/.exec(c)![1]);
    expect(min(s)).toBeLessThan(min(m));
    expect(min(m)).toBeLessThan(min(l));
  });
});

describe("Fotos: remembered choice", () => {
  it("saves the choice and restores it on the next visit", async () => {
    const first = show();
    await screen.findByRole("group", { name: "Set" });
    await userEvent.click(screen.getByRole("button", { name: "Rellenar" }));
    await userEvent.click(screen.getByRole("button", { name: "Grande" }));
    first.unmount();
    show();
    await screen.findByRole("group", { name: "Set" });
    expect(img("p1").className).toMatch(/object-cover/);
    expect(
      screen
        .getByRole("button", { name: "Grande" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("ignores garbage in storage", async () => {
    localStorage.setItem("381.photoFit", '{"mode":"x","size":9}');
    show();
    await screen.findByRole("group", { name: "Set" });
    expect(img("p1").className).toMatch(/object-contain/);
    expect(
      screen
        .getByRole("button", { name: "Mediano" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("works when localStorage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    show();
    await screen.findByRole("group", { name: "Set" });
    await userEvent.click(screen.getByRole("button", { name: "Rellenar" }));
    expect(img("p1").className).toMatch(/object-cover/);
  });
});

describe("Fotos: quick look", () => {
  async function ready() {
    show();
    await screen.findByRole("group", { name: "Set" });
    vi.useFakeTimers();
  }

  it("loads nothing on mount", async () => {
    await ready();
    expect(lookImgs()).toHaveLength(0);
  });

  it("appears after ~350 ms of hover: view-sm, aria-hidden, no focusable content", async () => {
    await ready();
    fireEvent.pointerEnter(tile("p2"));
    act(() => void vi.advanceTimersByTime(200));
    expect(lookImgs()).toHaveLength(0);
    act(() => void vi.advanceTimersByTime(200));
    expect(lookImgs()).toHaveLength(1);
    const look = lookImgs()[0].closest("[data-quick-look]") as HTMLElement;
    expect(lookImgs()[0].getAttribute("src")).toBe("/admin/img/p2/view-sm");
    expect(lookImgs()[0].className).toMatch(/object-contain/);
    expect(look.getAttribute("aria-hidden")).toBe("true");
    expect(look.className).toMatch(/pointer-events-none/);
    expect(look.querySelector("button, a, [tabindex]")).toBeNull();
  });

  it("appears on keyboard focus too", async () => {
    await ready();
    fireEvent.focus(within(tile("p3")).getByRole("button", { name: "square" }));
    act(() => void vi.advanceTimersByTime(400));
    expect(lookImgs()[0].getAttribute("src")).toBe("/admin/img/p3/view-sm");
  });

  it("does not appear if the pointer leaves before the delay", async () => {
    await ready();
    fireEvent.pointerEnter(tile("p2"));
    act(() => void vi.advanceTimersByTime(200));
    fireEvent.pointerLeave(tile("p2"));
    act(() => void vi.advanceTimersByTime(1000));
    expect(lookImgs()).toHaveLength(0);
  });

  it("hides on leave, blur, Escape, scroll, drag and when the viewer opens", async () => {
    await ready();
    const open = () => {
      fireEvent.pointerEnter(tile("p2"));
      act(() => void vi.advanceTimersByTime(400));
      expect(lookImgs()).toHaveLength(1);
    };
    open();
    fireEvent.pointerLeave(tile("p2"));
    expect(lookImgs()).toHaveLength(0);
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(lookImgs()).toHaveLength(0);
    open();
    fireEvent.scroll(window);
    expect(lookImgs()).toHaveLength(0);
    open();
    fireEvent.dragStart(tile("p2"));
    expect(lookImgs()).toHaveLength(0);
    open();
    fireEvent.click(
      within(tile("p2")).getByRole("button", { name: "Ver completa" }),
    );
    expect(document.querySelector("[data-quick-look]")).toBeNull();
  });

  it("never shows on touch / coarse pointers", async () => {
    media(false);
    await ready();
    fireEvent.pointerEnter(tile("p2"));
    fireEvent.focus(
      within(tile("p1")).getByRole("button", { name: "vertical" }),
    );
    act(() => void vi.advanceTimersByTime(2000));
    expect(lookImgs()).toHaveLength(0);
  });

  it("stays inside the viewport and does not shift layout (fixed box)", async () => {
    await ready();
    vi.spyOn(tile("p4"), "getBoundingClientRect").mockReturnValue({
      left: window.innerWidth - 20,
      right: window.innerWidth,
      top: window.innerHeight - 20,
      bottom: window.innerHeight,
      width: 20,
      height: 20,
      x: window.innerWidth - 20,
      y: window.innerHeight - 20,
      toJSON() {},
    });
    fireEvent.pointerEnter(tile("p4"));
    act(() => void vi.advanceTimersByTime(400));
    const look = document.querySelector("[data-quick-look]") as HTMLElement;
    expect(look.className).toMatch(/fixed/);
    const left = parseFloat(look.style.left);
    const top = parseFloat(look.style.top);
    const w = parseFloat(look.style.width);
    const h = parseFloat(look.style.height);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left + w).toBeLessThanOrEqual(window.innerWidth);
    expect(top + h).toBeLessThanOrEqual(window.innerHeight);
  });
});

describe("Fotos: existing behaviour is untouched", () => {
  it("select + arrow reorders, Mover después works, cover and view actions remain", async () => {
    show();
    await screen.findByRole("group", { name: "Set" });
    const first = within(tile("p1")).getByRole("button", { name: "vertical" });
    first.focus();
    await userEvent.keyboard("{Enter}{ArrowRight}");
    const ids = () =>
      Array.from(document.querySelectorAll("[data-photo-id]")).map((x) =>
        x.getAttribute("data-photo-id"),
      );
    expect(ids().slice(0, 2)).toEqual(["p2", "p1"]);
    await userEvent.click(
      screen.getByRole("button", { name: "Mover después" }),
    );
    expect(ids().slice(0, 3)).toEqual(["p2", "p3", "p1"]);
    expect(
      within(tile("p2")).getByRole("button", { name: "Usar como portada" }),
    ).toBeTruthy();
    expect(tile("p1").querySelector("[data-cover-badge=desktop]")).toBeTruthy();
    await userEvent.click(
      within(tile("p2")).getByRole("button", { name: "Ver completa" }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
