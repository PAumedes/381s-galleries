import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PhotoReorder,
  type ReorderPhoto,
} from "../../app/components/admin/PhotoReorder";
import { enAdmin as en } from "../../app/i18n/en.admin";
import { esAdmin as es } from "../../app/i18n/es.admin";

const photos: ReorderPhoto[] = ["a", "b", "c"].map((id) => ({
  id,
  set: "Set",
  name: `IMG_${id}`,
  takenAt: null,
}));

function show(props: Record<string, unknown> = {}) {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      Component: () => (
        <PhotoReorder
          photos={photos}
          version="v1"
          coverPhotoId="a"
          mobileCoverId="b"
          {...props}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin/g/g1"]} />);
}
const tile = (id: string) =>
  document.querySelector(`[data-photo-id="${id}"]`) as HTMLElement;
const bar = (id: string) =>
  tile(id).querySelector("[data-tile-actions]") as HTMLElement;

describe("T6.18 tile actions: icon + label bar under the picture", () => {
  it("every tile has a bar OUTSIDE the picture frame, always visible, three labelled buttons", async () => {
    show();
    await screen.findAllByRole("listitem");
    for (const id of ["a", "b", "c"]) {
      const b = bar(id);
      expect(b).toBeTruthy();
      expect(b.closest("[data-thumb-frame]")).toBeNull();
      expect(b.className).not.toMatch(/invisible|\bhidden\b/);
      const btns = within(b).getAllByRole("button");
      expect(btns).toHaveLength(3);
      for (const x of btns) {
        expect(x.querySelector("svg")).toBeTruthy();
        expect(x.getAttribute("title")).toBeTruthy();
        expect(x.textContent!.trim().length).toBeGreaterThan(0);
        // visible label is part of the accessible name (WCAG 2.5.3)
        const name = (x.getAttribute("aria-label") ?? x.textContent)!;
        expect(name.toLowerCase()).toContain(
          x.textContent!.trim().toLowerCase(),
        );
      }
    }
    expect(tile("c").querySelector("[data-thumb-frame] button")).toBeNull();
  });

  it("visible short labels, accessible names, focus order after the picture", async () => {
    show();
    await screen.findAllByRole("listitem");
    const btns = within(bar("c")).getAllByRole("button");
    expect(btns.map((x) => x.textContent!.trim())).toEqual([
      "Portada",
      "Móvil",
      "Ver",
    ]);
    expect(btns.map((x) => x.getAttribute("aria-label"))).toEqual([
      "Usar como portada",
      "Usar como portada móvil",
      "Ver completa",
    ]);
    const handle = tile("c").querySelector("[role=button][id]")!;
    const all = Array.from(tile("c").querySelectorAll("button,[role=button]"));
    expect(all[0]).toBe(handle);
    expect(all.slice(1)).toEqual(btns);
  });

  it("the current cover shows a pressed, disabled state instead of an action", async () => {
    show();
    await screen.findAllByRole("listitem");
    const [desk, mob] = within(bar("a")).getAllByRole("button");
    expect(desk.getAttribute("aria-pressed")).toBe("true");
    expect((desk as HTMLButtonElement).disabled).toBe(true);
    expect(mob.getAttribute("aria-pressed")).toBe("false");
    const [, mobB] = within(bar("b")).getAllByRole("button");
    expect(mobB.getAttribute("aria-pressed")).toBe("true");
    expect((mobB as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(tile("a")).queryByRole("button", { name: "Usar como portada" }),
    ).toBeNull();
  });

  it("badges show icon and readable text and are not the only state", async () => {
    show();
    await screen.findAllByRole("listitem");
    const d = tile("a").querySelector("[data-cover-badge=desktop]")!;
    const m = tile("b").querySelector("[data-cover-badge=mobile]")!;
    expect(d.querySelector(".sr-only")).toBeNull();
    expect(d.textContent).toBe("Portada");
    expect(m.textContent).toBe("Móvil");
  });

  it("narrow tiles restack the bar via a container query, buttons keep >=44px targets", async () => {
    show();
    await screen.findAllByRole("listitem");
    expect(tile("c").className).toContain("@container");
    expect(bar("c").className).toContain("@max-");
    for (const x of within(bar("c")).getAllByRole("button"))
      expect(x.className).toContain("min-h-tap");
  });

  it("the cover form posts exactly what it always posted", async () => {
    show();
    await screen.findAllByRole("listitem");
    const f = within(bar("c"))
      .getByRole("button", { name: "Usar como portada" })
      .closest("form")!;
    expect(f.querySelector<HTMLInputElement>("[name=intent]")!.value).toBe(
      "cover",
    );
    expect(f.querySelector<HTMLInputElement>("[name=photoId]")!.value).toBe(
      "c",
    );
    expect(f.querySelector("[name=device]")).toBeNull();
    const fm = within(bar("c"))
      .getByRole("button", { name: "Usar como portada móvil" })
      .closest("form")!;
    expect(fm.querySelector<HTMLInputElement>("[name=device]")!.value).toBe(
      "mobile",
    );
  });

  it("automatic cover can still be pinned", async () => {
    show({ coverAuto: true, mobileCoverId: null });
    await screen.findAllByRole("listitem");
    expect(
      within(bar("a")).getByRole("button", { name: "Usar como portada" }),
    ).toBeTruthy();
  });
});

describe("T6.18 tile actions: quick look", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as never;
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const looks = () => document.querySelectorAll("[data-quick-look]");

  it("hovering the picture opens it; moving onto the bar does not (and closes it)", async () => {
    show();
    await screen.findAllByRole("listitem");
    const frame = tile("c").querySelector("[data-thumb-frame]")!;
    fireEvent.pointerEnter(frame, { pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(400));
    expect(looks()).toHaveLength(1);
    fireEvent.pointerEnter(bar("c"), { pointerType: "mouse" });
    expect(looks()).toHaveLength(0);
    act(() => void vi.advanceTimersByTime(800));
    expect(looks()).toHaveLength(0);
  });

  it("keyboard focus on a bar button does not open it", async () => {
    show();
    await screen.findAllByRole("listitem");
    const btn = within(bar("c")).getByRole("button", { name: "Ver completa" });
    act(() => btn.focus());
    act(() => void vi.advanceTimersByTime(800));
    expect(looks()).toHaveLength(0);
  });
});

describe("T6.18 tile actions: dictionaries", () => {
  const keys = [
    "admin.reorder.tileCover",
    "admin.reorder.tileMobile",
    "admin.reorder.tileView",
    "admin.reorder.isCover",
    "admin.reorder.isMobileCover",
  ];
  it("exist in es and en", () => {
    for (const k of keys) {
      expect((es as Record<string, string>)[k]).toBeTruthy();
      expect((en as Record<string, string>)[k]).toBeTruthy();
    }
  });
});
