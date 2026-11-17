import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import {
  ActivityView,
  type ActivityViewData,
} from "../../app/components/admin/ActivityView";

const row = (over = {}) => ({
  id: "d1",
  createdAt: "2026-11-16T02:30:00Z",
  email: "ana@example.com",
  variant: "web",
  country: "AR",
  photoId: "p1",
  name: "IMG_1",
  set: "Highlights",
  ...over,
});

const data: ActivityViewData = {
  gallery: { id: "g1", title: "Boda Ana", slug: "boda-ana" },
  summary: { views: 7, visitors: 2, photos: 5, bulks: 1 },
  rows: [
    row(),
    row({ id: "d2", email: null, name: "IMG_2", photoId: "p2", variant: "ig" }),
    {
      ...row({
        id: "h1",
        photoId: null,
        name: null,
        set: null,
        variant: "highres",
      }),
      bulk: {
        scope: "set:Fiesta",
        count: 2,
        children: [
          row({ id: "c1", name: "IMG_8", photoId: "p8", variant: "highres" }),
          row({ id: "c2", name: "IMG_9", photoId: "p9", variant: "highres" }),
        ],
      },
    },
  ],
  next: "2026-01-01T00:00:00Z|d0",
  filters: { visitor: "", size: "" },
  visitorOptions: ["ana@example.com", "bob@example.com"],
  views: [
    { createdAt: "2026-11-16T02:30:00Z", email: null, country: "UY" },
    {
      createdAt: "2026-11-15T12:00:00Z",
      email: "ana@example.com",
      country: null,
    },
  ],
};

function show(d: ActivityViewData = data) {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1/activity",
      Component: () => <ActivityView data={d} />,
    },
  ]);
  return render(<Stub initialEntries={["/admin/g/g1/activity"]} />);
}

describe("ActivityView", () => {
  it("shows summary cards", async () => {
    show();
    const card = async (label: string) =>
      (await screen.findByText(label)).closest("div")!;
    expect(within(await card("Visitas")).getByText("7")).toBeTruthy();
    expect(
      within(await card("Visitantes con email")).getByText("2"),
    ).toBeTruthy();
    expect(within(await card("Fotos descargadas")).getByText("5")).toBeTruthy();
    expect(
      within(await card("Descargas completas")).getByText("1"),
    ).toBeTruthy();
  });

  it("lists rows with BA time, who (email or Anónimo), size label, country and thumb", async () => {
    show();
    const table = await screen.findByRole("table", { name: "Descargas" });
    expect(
      within(table).getAllByText("15/11/2026 23:30").length,
    ).toBeGreaterThan(0);
    expect(
      within(table).getAllByText("ana@example.com").length,
    ).toBeGreaterThan(0);
    expect(within(table).getAllByText("Anónimo").length).toBeGreaterThan(0);
    expect(within(table).getByText("IMG_1")).toBeTruthy();
    expect(within(table).getByText("Instagram")).toBeTruthy();
    const img = within(table).getAllByRole("img")[0] as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/admin/img/p1/thumb");
  });

  it("bulk header shows the title and expands/collapses its photos", async () => {
    const user = userEvent.setup();
    show();
    expect(
      await screen.findByText("Descarga completa: Set Fiesta (2 fotos)"),
    ).toBeTruthy();
    expect(screen.queryByText("IMG_8")).toBeNull();
    const btn = screen.getByRole("button", { name: /Ver fotos/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    await user.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("IMG_8")).toBeTruthy();
    expect(screen.getByText("IMG_9")).toBeTruthy();
    await user.click(btn);
    expect(screen.queryByText("IMG_8")).toBeNull();
  });

  it("filter form keeps current values and lists visitors + anonymous", async () => {
    show({ ...data, filters: { visitor: "bob@example.com", size: "ig" } });
    const v = (await screen.findByLabelText("Visitante")) as HTMLSelectElement;
    expect(v.value).toBe("bob@example.com");
    expect(Array.from(v.options).map((o) => o.text)).toEqual([
      "Todos",
      "Anónimos",
      "ana@example.com",
      "bob@example.com",
    ]);
    expect((screen.getByLabelText("Tamaño") as HTMLSelectElement).value).toBe(
      "ig",
    );
  });

  it("next page link carries the cursor and filters; CSV link; tabs", async () => {
    show({ ...data, filters: { visitor: "", size: "web" } });
    const more = (await screen.findByRole("link", {
      name: /Más antiguas/,
    })) as HTMLAnchorElement;
    const u = new URL(more.href, "http://x");
    expect(u.pathname).toBe("/admin/g/g1/activity");
    expect(u.searchParams.get("cursor")).toBe("2026-01-01T00:00:00Z|d0");
    expect(u.searchParams.get("size")).toBe("web");
    const csv = screen.getByRole("link", {
      name: /Exportar CSV/,
    }) as HTMLAnchorElement;
    expect(csv.getAttribute("href")).toBe("/admin/g/g1/activity.csv");
    const fav = screen.getByRole("link", { name: "Favoritos" });
    expect(fav.getAttribute("href")).toBe("/admin/g/g1/favorites");
    expect(
      screen
        .getByRole("link", { name: "Actividad" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("no next link without a cursor; visits table", async () => {
    show({ ...data, next: null });
    expect(screen.queryByRole("link", { name: /Más antiguas/ })).toBeNull();
    const t = await screen.findByRole("table", { name: "Visitas" });
    expect(within(t).getByText("UY")).toBeTruthy();
    expect(within(t).getByText("15/11/2026 09:00")).toBeTruthy();
  });

  it("empty state", async () => {
    show({ ...data, rows: [], next: null, views: [] });
    expect(await screen.findByText("Sin descargas todavía.")).toBeTruthy();
  });

  it("every table header has scope=col", async () => {
    const { container } = show();
    await screen.findByRole("table", { name: "Descargas" });
    const ths = [...container.querySelectorAll("th")];
    expect(ths.length).toBeGreaterThan(0);
    for (const th of ths) expect(th.getAttribute("scope")).toBe("col");
  });
});
