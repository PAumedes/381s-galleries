import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import {
  GalleryList,
  type GalleryListItem,
} from "../../app/components/admin/GalleryList";
import type { Filter } from "../../app/lib/admin-gallery";

const item = (over: Partial<GalleryListItem> = {}): GalleryListItem => ({
  id: "g1",
  title: "Boda Ana",
  slug: "boda-ana",
  eventDate: "2026-11-01",
  status: "published",
  expiresAt: null,
  expired: false,
  coverPhotoId: "p1",
  photoCount: 120,
  views: 33,
  downloads: 7,
  issueCount: 0,
  ...over,
});

function show(
  galleries: GalleryListItem[],
  filter: Filter = "todas",
  total = galleries.length,
) {
  const Stub = createRoutesStub([
    {
      path: "/admin",
      Component: () => (
        <GalleryList galleries={galleries} filter={filter} total={total} />
      ),
    },
    { path: "/admin/g/:id", Component: () => <p>edit page</p> },
  ]);
  return render(<Stub initialEntries={["/admin"]} />);
}

describe("GalleryList", () => {
  it("renders a row with title link, thumb via the admin image route, counts, status", async () => {
    show([item()]);
    const link = await screen.findByRole("link", { name: "Boda Ana" });
    expect(link.getAttribute("href")).toBe("/admin/g/g1");
    const img = document.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/admin/img/p1/thumb");
    expect(img.getAttribute("alt")).toBe("");
    const row = link.closest("tr")!;
    expect(within(row).getByText("120")).toBeTruthy();
    expect(within(row).getByText("33")).toBeTruthy();
    expect(within(row).getByText("7")).toBeTruthy();
    expect(within(row).getByText("Publicada")).toBeTruthy();
    expect(within(row).getByText("01/11/2026")).toBeTruthy();
    expect(within(row).getByText("Sin vencimiento")).toBeTruthy();
  });

  it("status pills: borrador, archivada, expirada; issue badge only when > 0", async () => {
    show([
      item({ id: "a", title: "A", status: "draft" }),
      item({ id: "b", title: "B", status: "archived" }),
      item({
        id: "c",
        title: "C",
        status: "published",
        expired: true,
        expiresAt: "2020-01-01T03:00:00Z",
        issueCount: 4,
        coverPhotoId: null,
      }),
    ]);
    await screen.findByText("Borrador");
    expect(screen.getByText("Archivada")).toBeTruthy();
    expect(screen.getByText("Expirada")).toBeTruthy();
    const c = screen.getByRole("link", { name: "C" }).closest("tr")!;
    expect(within(c).getByLabelText("4 avisos de sincronización")).toBeTruthy();
    expect(within(c).queryByRole("img")).toBeNull();
    expect(within(c).getByText("01/01/2020 00:00")).toBeTruthy();
    const a = screen.getByRole("link", { name: "A" }).closest("tr")!;
    expect(within(a).queryByLabelText(/avisos/)).toBeNull();
  });

  it("filter tabs link to ?estado= and mark the active one", async () => {
    show([item()], "borradores");
    const nav = await screen.findByRole("navigation", {
      name: "Filtrar galerías",
    });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Todas",
      "Publicadas",
      "Borradores",
      "Archivadas",
    ]);
    expect(links[0].getAttribute("href")).toBe("/admin");
    expect(links[1].getAttribute("href")).toBe("/admin?estado=publicadas");
    expect(links[2].getAttribute("aria-current")).toBe("page");
    expect(links[0].getAttribute("aria-current")).toBeNull();
  });

  it("empty library: explains the Drive folder convention", async () => {
    show([], "todas", 0);
    expect(await screen.findByText(/Todavía no hay galerías/)).toBeTruthy();
    const text = document.body.textContent ?? "";
    for (const w of [
      "381studios",
      "high-res",
      "web",
      "thumb",
      "preview-wm",
      "ig",
    ])
      expect(text).toContain(w);
    expect(
      screen.getByRole("link", { name: /Ajustes/ }).getAttribute("href"),
    ).toBe("/admin/setup");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("empty filter: short message, not the convention", async () => {
    show([], "archivadas", 3);
    expect(
      await screen.findByText(/No hay galerías en este filtro/),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("high-res");
  });
});
