import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FavoritesView,
  type FavoritesViewData,
} from "../../app/components/admin/FavoritesView";

const ph = (id: string, name: string, hidden = false) => ({
  id,
  name,
  set: "Highlights",
  hidden,
});

const data: FavoritesViewData = {
  gallery: { id: "g1", title: "Boda Ana", slug: "boda-ana" },
  visitors: [
    {
      id: "v1",
      label: "ana@example.com",
      anon: false,
      lists: [
        {
          name: "Favoritos",
          count: 3,
          last: "2026-11-16T02:30:00Z",
          photos: [
            ph("p1", "IMG_1"),
            ph("p2", "IMG_2.jpg"),
            ph("p4", "IMG_4", true),
          ],
        },
      ],
    },
    {
      id: "abc123-0000",
      label: "Anónimo #abc123",
      anon: true,
      lists: [
        {
          name: "Favoritos",
          count: 1,
          last: "2026-11-15T12:00:00Z",
          photos: [ph("p3", "IMG_3")],
        },
      ],
    },
  ],
  all: [
    { ...ph("p2", "IMG_2.jpg"), picks: 2 },
    { ...ph("p1", "IMG_1"), picks: 1 },
    { ...ph("p4", "IMG_4", true), picks: 1 },
  ],
};

let writeText: ReturnType<typeof vi.fn>;
// userEvent.setup() installs its own clipboard stub, so replace it afterwards.
function setupUser() {
  const user = userEvent.setup();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return user;
}
afterEach(() => vi.restoreAllMocks());

function show(d: FavoritesViewData = data) {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1/favorites",
      Component: () => <FavoritesView data={d} />,
    },
  ]);
  return render(<Stub initialEntries={["/admin/g/g1/favorites"]} />);
}

describe("FavoritesView", () => {
  it("lists visitors with list name, count and last activity (BA time)", async () => {
    show();
    const ana = (await screen.findByText("ana@example.com")).closest(
      "section",
    )!;
    expect(within(ana).getByText(/Favoritos/)).toBeTruthy();
    expect(within(ana).getByText("3 fotos")).toBeTruthy();
    expect(within(ana).getByText("15/11/2026 23:30")).toBeTruthy();
    expect(screen.getByText("Anónimo #abc123")).toBeTruthy();
  });

  it("expanding shows the thumbs grid with base names; hidden ones greyed with (oculta)", async () => {
    const user = setupUser();
    show();
    const ana = (await screen.findByText("ana@example.com")).closest(
      "section",
    )!;
    expect(within(ana).queryByText("IMG_1")).toBeNull();
    const btn = within(ana).getByRole("button", { name: /Ver fotos/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    await user.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(within(ana).getByText("IMG_1")).toBeTruthy();
    const imgs = within(ana).getAllByRole("img") as HTMLImageElement[];
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      "/admin/img/p1/thumb",
      "/admin/img/p2/thumb",
    ]);
    const hidden = within(ana).getByText(/IMG_4/);
    expect(hidden.textContent).toContain("(oculta)");
    expect(hidden.closest("li")!.className).toContain("opacity");
  });

  it("copy button writes space-separated base names (no extension, existing photos only)", async () => {
    const user = setupUser();
    show();
    const ana = (await screen.findByText("ana@example.com")).closest(
      "section",
    )!;
    await user.click(
      within(ana).getByRole("button", { name: "Copiar para Capture One" }),
    );
    expect(writeText).toHaveBeenCalledWith("IMG_1 IMG_2");
    expect(await within(ana).findByText("Copiado")).toBeTruthy();
  });

  it("comma toggle switches the format for every copy button", async () => {
    const user = setupUser();
    show();
    await user.click(await screen.findByLabelText("Separar con comas"));
    const ana = screen.getByText("ana@example.com").closest("section")!;
    await user.click(
      within(ana).getByRole("button", { name: "Copiar para Capture One" }),
    );
    expect(writeText).toHaveBeenLastCalledWith("IMG_1,IMG_2");
    const all = screen.getByRole("region", { name: "Todos los favoritos" });
    await user.click(
      within(all).getByRole("button", { name: "Copiar para Capture One" }),
    );
    expect(writeText).toHaveBeenLastCalledWith("IMG_2,IMG_1");
  });

  it("combined section shows picks per photo and copies the union", async () => {
    const user = setupUser();
    show();
    const all = await screen.findByRole("region", {
      name: "Todos los favoritos",
    });
    expect(within(all).getByText("2 visitantes")).toBeTruthy();
    expect(within(all).getAllByText("1 visitante").length).toBe(2);
    await user.click(
      within(all).getByRole("button", { name: "Copiar para Capture One" }),
    );
    expect(writeText).toHaveBeenCalledWith("IMG_2 IMG_1");
  });

  it("txt download links point at the resource route", async () => {
    show();
    const ana = (await screen.findByText("ana@example.com")).closest(
      "section",
    )!;
    const a = within(ana).getByRole("link", { name: "Descargar .txt" });
    expect(a.getAttribute("href")).toBe("/admin/g/g1/favorites.txt?visitor=v1");
    const all = screen.getByRole("region", { name: "Todos los favoritos" });
    expect(
      within(all)
        .getByRole("link", { name: "Descargar .txt" })
        .getAttribute("href"),
    ).toBe("/admin/g/g1/favorites.txt");
  });

  it("copy failure shows an error instead of success", async () => {
    const user = setupUser();
    writeText.mockRejectedValue(new Error("denied"));
    show();
    const ana = (await screen.findByText("ana@example.com")).closest(
      "section",
    )!;
    await user.click(
      within(ana).getByRole("button", { name: "Copiar para Capture One" }),
    );
    expect(await within(ana).findByText("No se pudo copiar")).toBeTruthy();
  });

  it("empty state; tabs link back to activity", async () => {
    show({ ...data, visitors: [], all: [] });
    expect(
      await screen.findByText("Nadie marcó favoritos todavía."),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Actividad" }).getAttribute("href"),
    ).toBe("/admin/g/g1/activity");
    expect(
      screen
        .getByRole("link", { name: "Favoritos" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});
