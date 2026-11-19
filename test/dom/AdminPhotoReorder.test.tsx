import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import {
  PhotoReorder,
  type ReorderPhoto,
} from "../../app/components/admin/PhotoReorder";

const photos: ReorderPhoto[] = [
  {
    id: "a",
    set: "Highlights",
    name: "IMG_3",
    takenAt: "2026-01-01T12:00:00Z",
  },
  {
    id: "b",
    set: "Highlights",
    name: "IMG_1",
    takenAt: "2026-01-01T10:00:00Z",
  },
  { id: "c", set: "Highlights", name: "IMG_2", takenAt: null },
  { id: "d", set: "Fiesta", name: "F_2", takenAt: null },
  { id: "e", set: "Fiesta", name: "F_1", takenAt: null },
];

function show(p: ReorderPhoto[] = photos, actionData?: unknown) {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      Component: () => (
        <PhotoReorder
          photos={p}
          version="v1"
          actionData={actionData as never}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin/g/g1"]} />);
}
const order = () =>
  JSON.parse(
    (document.querySelector("input[name=order]") as HTMLInputElement).value,
  ) as Record<string, string[]>;
const names = (set: string) =>
  Array.from(
    document.querySelectorAll(`[data-set="${set}"] [data-photo-id]`),
  ).map((x) => x.getAttribute("data-photo-id"));

describe("PhotoReorder", () => {
  it("renders one grid per set, thumbs via the admin image route, hidden version", async () => {
    show();
    await screen.findByRole("group", { name: "Highlights" });
    expect(screen.getByRole("group", { name: "Fiesta" })).toBeTruthy();
    expect(names("Highlights")).toEqual(["a", "b", "c"]);
    expect(document.querySelector("img")!.getAttribute("src")).toBe(
      "/admin/img/a/thumb",
    );
    expect(
      (document.querySelector("input[name=version]") as HTMLInputElement).value,
    ).toBe("v1");
    expect(
      (
        screen.getByRole("button", {
          name: "Guardar orden",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("keyboard: select with Enter, arrows move, focus stays, save enabled", async () => {
    const user = userEvent.setup();
    show();
    const b = await screen.findByRole("button", { name: /IMG_1/ });
    b.focus();
    await user.keyboard("{Enter}");
    expect(b.getAttribute("aria-pressed")).toBe("true");
    await user.keyboard("{ArrowRight}");
    expect(names("Highlights")).toEqual(["a", "c", "b"]);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /IMG_1/ }),
    );
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(names("Highlights")).toEqual(["b", "a", "c"]);
    expect(order()).toEqual({
      Highlights: ["b", "a", "c"],
      Fiesta: ["d", "e"],
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Guardar orden",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.getByRole("status").textContent).toMatch(/posición 1 de 3/);
  });

  it("arrows do nothing without a selection; Escape deselects", async () => {
    const user = userEvent.setup();
    show();
    const b = await screen.findByRole("button", { name: /IMG_1/ });
    b.focus();
    await user.keyboard("{ArrowRight}");
    expect(names("Highlights")).toEqual(["a", "b", "c"]);
    await user.keyboard("{Enter}{Escape}");
    expect(b.getAttribute("aria-pressed")).toBe("false");
    await user.keyboard("{ArrowRight}");
    expect(names("Highlights")).toEqual(["a", "b", "c"]);
  });

  it("Home/End move to the edges and never cross sets", async () => {
    const user = userEvent.setup();
    show();
    const b = await screen.findByRole("button", { name: /IMG_1/ });
    b.focus();
    await user.keyboard("{Enter}{End}");
    expect(names("Highlights")).toEqual(["a", "c", "b"]);
    await user.keyboard("{Home}");
    expect(names("Highlights")).toEqual(["b", "a", "c"]);
    await user.keyboard("{ArrowLeft}");
    expect(names("Highlights")).toEqual(["b", "a", "c"]);
    expect(names("Fiesta")).toEqual(["d", "e"]);
  });

  it("Mover antes / Mover después buttons act on the selected photo", async () => {
    const user = userEvent.setup();
    show();
    const before = screen.getAllByRole("button", {
      name: "Mover antes",
    })[0] as HTMLButtonElement;
    expect(before.disabled).toBe(true);
    await user.click(await screen.findByRole("button", { name: /IMG_1/ }));
    expect(before.disabled).toBe(false);
    await user.click(
      screen.getAllByRole("button", { name: "Mover después" })[0],
    );
    expect(names("Highlights")).toEqual(["a", "c", "b"]);
    await user.click(screen.getAllByRole("button", { name: "Mover antes" })[0]);
    await user.click(screen.getAllByRole("button", { name: "Mover antes" })[0]);
    expect(names("Highlights")).toEqual(["b", "a", "c"]);
  });

  it("quick sorts act per set and are undoable via Restablecer", async () => {
    const user = userEvent.setup();
    show();
    await user.click(
      (await screen.findAllByRole("button", { name: "Ordenar por nombre" }))[0],
    );
    expect(names("Highlights")).toEqual(["b", "c", "a"]);
    expect(names("Fiesta")).toEqual(["d", "e"]);
    await user.click(
      screen.getAllByRole("button", {
        name: "Ordenar por fecha de captura",
      })[0],
    );
    expect(names("Highlights")).toEqual(["b", "a", "c"]);
    await user.click(screen.getByRole("button", { name: "Restablecer" }));
    expect(names("Highlights")).toEqual(["a", "b", "c"]);
  });

  it("drag and drop: dropping onto a tile moves the dragged photo there", async () => {
    show();
    await screen.findByRole("group", { name: "Highlights" });
    const tile = (id: string) =>
      document.querySelector(`[data-photo-id="${id}"]`)!;
    const dt = {
      setData() {},
      getData: () => "",
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(tile("c"), { dataTransfer: dt });
    fireEvent.dragOver(tile("a"), { dataTransfer: dt });
    fireEvent.drop(tile("a"), { dataTransfer: dt });
    expect(names("Highlights")).toEqual(["c", "a", "b"]);
    // dropping on another set's tile is ignored
    fireEvent.dragStart(tile("c"), { dataTransfer: dt });
    fireEvent.drop(tile("d"), { dataTransfer: dt });
    expect(names("Highlights")).toEqual(["c", "a", "b"]);
    expect(names("Fiesta")).toEqual(["d", "e"]);
  });

  it("shows stale / error feedback from the action", async () => {
    show(photos, {
      intent: "reorder",
      ok: false,
      stale: true,
      error: "La galería cambió. Recargá la página.",
    });
    expect(await screen.findByText(/Recargá la página/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Recargar" })).toBeTruthy();
  });
});

describe("PhotoReorder cover controls", () => {
  it("badge on the cover tile, 'Usar como portada' form on the others, not draggable-blocking", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin/g/g1",
        Component: () => (
          <PhotoReorder photos={photos} version="v1" coverPhotoId="b" />
        ),
      },
    ]);
    render(<Stub initialEntries={["/admin/g/g1"]} />);
    const tiles = await screen.findAllByRole("listitem");
    const b = tiles.find((t) => t.getAttribute("data-photo-id") === "b")!;
    // A small badge (icon + accessible label), once, on the cover tile.
    expect(b.querySelector('[data-cover-badge="desktop"]')!.textContent).toBe(
      "Portada",
    );
    expect(document.querySelectorAll("[data-cover-badge]")).toHaveLength(1);
    expect(
      Array.from(b.querySelectorAll("button")).some(
        (x) => x.textContent === "Usar como portada",
      ),
    ).toBe(false);
    expect(
      screen.getAllByRole("button", { name: "Usar como portada" }),
    ).toHaveLength(photos.length - 1);
    // Not nested inside the select/drag handle (no interactive-in-interactive).
    for (const btn of screen.getAllByRole("button", {
      name: /Usar como portada/,
    }))
      expect(btn.closest("[role=button]:not(button)")).toBeNull();
  });
});

describe("PhotoReorder automatic cover", () => {
  it("badge says automatic and the tile still offers to pin it (cover form with its id)", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin/g/g1",
        Component: () => (
          <PhotoReorder
            photos={photos}
            version="v1"
            coverPhotoId="b"
            coverAuto
          />
        ),
      },
    ]);
    render(<Stub initialEntries={["/admin/g/g1"]} />);
    const tiles = await screen.findAllByRole("listitem");
    const b = tiles.find((t) => t.getAttribute("data-photo-id") === "b")!;
    expect(
      b.querySelector('[data-cover-badge="desktop"]')!.getAttribute("title"),
    ).toBe("Portada automática (primera foto)");
    const pin = within(b).getByRole("button", { name: "Usar como portada" });
    const form = pin.closest("form")!;
    expect(
      (form.querySelector("input[name=intent]") as HTMLInputElement).value,
    ).toBe("cover");
    expect(
      (form.querySelector("input[name=photoId]") as HTMLInputElement).value,
    ).toBe("b");
  });
});
