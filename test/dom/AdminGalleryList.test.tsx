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
  clientName: null,
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
  rootName?: string | null,
) {
  const Stub = createRoutesStub([
    {
      path: "/admin",
      Component: () => (
        <GalleryList
          galleries={galleries}
          filter={filter}
          total={total}
          rootName={rootName}
        />
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
      "studio-galleries",
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
    expect(text).not.toContain("381studios");
  });

  it("empty library: shows the saved Drive root folder name", async () => {
    show([], "todas", 0, "Mi Estudio");
    expect(await screen.findByText(/Todavía no hay galerías/)).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Mi Estudio/");
    expect(text).not.toContain("studio-galleries");
  });

  it("empty filter: short message, not the convention", async () => {
    show([], "archivadas", 3);
    expect(
      await screen.findByText(/No hay galerías en este filtro/),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("high-res");
  });
});

describe("GalleryList client name and search", () => {
  it("shows the client name muted under the title, nothing when null", async () => {
    show([
      item({ clientName: "María Pérez" }),
      item({ id: "g2", title: "Otra", slug: "otra", clientName: null }),
    ]);
    const link = await screen.findByRole("link", { name: "Boda Ana" });
    expect(within(link.closest("td")!).getByText("María Pérez")).toBeTruthy();
    const other = screen.getByRole("link", { name: "Otra" }).closest("td")!;
    expect(other.textContent).toBe("Otra/otra");
  });
  it("search box: GET form with q, keeps the status filter, prefilled", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin",
        Component: () => (
          <GalleryList
            galleries={[item()]}
            filter="borradores"
            total={1}
            q="ana"
          />
        ),
      },
    ]);
    render(<Stub initialEntries={["/admin?estado=borradores&q=ana"]} />);
    const box = (await screen.findByRole("searchbox")) as HTMLInputElement;
    expect(box.name).toBe("q");
    expect(box.value).toBe("ana");
    const form = box.closest("form")!;
    expect(form.method).toBe("get");
    expect(
      (form.querySelector("input[name=estado]") as HTMLInputElement).value,
    ).toBe("borradores");
    expect(
      screen.getByRole("link", { name: "Publicadas" }).getAttribute("href"),
    ).toBe("/admin?estado=publicadas&q=ana");
  });
  it("no match with a query says so (not the empty-library guide)", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin",
        Component: () => (
          <GalleryList galleries={[]} filter="todas" total={4} q="zzz" />
        ),
      },
    ]);
    render(<Stub initialEntries={["/admin?q=zzz"]} />);
    expect(
      await screen.findByText(/No hay galerías que coincidan/),
    ).toBeTruthy();
  });
  it("the search box is hidden for an empty library", async () => {
    show([], "todas", 0);
    await screen.findByText(/Todavía no hay galerías/);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
