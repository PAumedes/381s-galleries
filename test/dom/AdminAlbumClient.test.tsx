import { fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import {
  GalleryEditView,
  type GalleryEditData,
} from "../../app/components/admin/GalleryEditView";
import {
  GalleryList,
  type GalleryListItem,
} from "../../app/components/admin/GalleryList";

const clients = [
  { id: "c1", name: "Acme", slug: "acme" },
  { id: "c2", name: "Beta", slug: "beta" },
];

const edit = (g: Partial<GalleryEditData["gallery"]>, url = "/admin/g/g1") => {
  const data = {
    gallery: {
      id: "g1",
      title: "Boda",
      slug: "boda",
      clientName: null,
      clientId: null,
      clientSlug: null,
      eventDate: null,
      expires: null,
      status: "published",
      allowHighres: true,
      allowWeb: true,
      allowIg: true,
      allowBulk: true,
      requireEmail: false,
      mode: "delivery",
      palette: "claro",
      coverLayout: "completa",
      gridStyle: "filas",
      gridGap: "normal",
      hasPin: false,
      showOnHome: false,
      coverPhotoId: null,
      coverFocus: null,
      ...g,
    },
    clients,
    hasWmFiles: false,
    hasThumbWmFiles: false,
    photoCount: 0,
    wmCount: 0,
    photos: [],
    version: "v",
    issues: { groups: [], truncated: 0, total: 0 },
  } as unknown as GalleryEditData;
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      Component: () => (
        <GalleryEditView
          data={data}
          origin="https://gallery.example"
          actionData={undefined}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={[url]} />);
};

describe("T6.40c album client select", () => {
  it("offers none + every client, preselects the assigned one, posts clientId", async () => {
    edit({ clientId: "c2", clientSlug: "beta" });
    const sel = (await screen.findByLabelText(
      "Carpeta de cliente",
    )) as HTMLSelectElement;
    expect(sel.name).toBe("clientId");
    expect([...sel.options].map((o) => [o.value, o.text])).toEqual([
      ["", "Sin cliente"],
      ["c1", "Acme"],
      ["c2", "Beta"],
    ]);
    expect(sel.value).toBe("c2");
    expect(sel.closest("form")!.querySelector("[name=intent]")).toBeTruthy();
  });

  it("unassigned album preselects none", async () => {
    edit({});
    expect(
      (
        (await screen.findByLabelText(
          "Carpeta de cliente",
        )) as HTMLSelectElement
      ).value,
    ).toBe("");
  });

  it("the select is 48px high on phones and 16px text (no iOS zoom)", async () => {
    edit({});
    const sel = await screen.findByLabelText("Carpeta de cliente");
    expect(sel.className).toContain("min-h-12");
    expect(sel.className).toContain("text-base");
  });

  it("share panel link uses /<client>/<album> for an assigned album, /<album> otherwise", async () => {
    const a = edit(
      { clientSlug: "acme", clientId: "c1" },
      "/admin/g/g1?tab=compartir",
    );
    const input = (await screen.findByLabelText(/enlace/i)) as HTMLInputElement;
    expect(input.value).toBe("https://gallery.example/acme/boda");
    a.unmount();
    edit({}, "/admin/g/g1?tab=compartir");
    expect(
      ((await screen.findByLabelText(/enlace/i)) as HTMLInputElement).value,
    ).toBe("https://gallery.example/boda");
  });
});

const item = (over: Partial<GalleryListItem> = {}): GalleryListItem => ({
  id: "g1",
  title: "Boda Ana",
  slug: "boda-ana",
  clientName: null,
  client: null,
  eventDate: null,
  status: "published",
  mode: "delivery",
  expiresAt: null,
  expired: false,
  coverPhotoId: null,
  photoCount: 1,
  views: 0,
  downloads: 0,
  issueCount: 0,
  deleting: false,
  ...over,
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}
function list(
  galleries: GalleryListItem[],
  o: {
    clientFilter?: string;
    filter?: "todas" | "publicadas";
    q?: string;
  } = {},
) {
  const Stub = createRoutesStub([
    {
      path: "/admin",
      Component: () => (
        <>
          <GalleryList
            galleries={galleries}
            filter={o.filter ?? "todas"}
            total={5}
            q={o.q}
            clientFilter={o.clientFilter}
            clients={clients}
          />
          <Where />
        </>
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin"]} />);
}

describe("T6.40c GalleryList client column and filter", () => {
  it("shows the client name in the row and the canonical path on desktop", async () => {
    list([
      item({ client: { id: "c1", name: "Acme", slug: "acme" } }),
      item({ id: "g2", title: "Sola", slug: "sola" }),
    ]);
    const row = (await screen.findByRole("link", { name: "Boda Ana" })).closest(
      "tr",
    )!;
    expect(within(row).getByText("Acme")).toBeTruthy();
    expect(within(row).getByText("/acme/boda-ana")).toBeTruthy();
    const other = screen.getByRole("link", { name: "Sola" }).closest("tr")!;
    expect(within(other).getByText("/sola")).toBeTruthy();
    expect(other.querySelector("[data-client-folder]")).toBeNull();
  });

  it("filter select lists all / none / each client and navigates with ?cliente=", async () => {
    list([item()], { filter: "publicadas", q: "ana" });
    const sel = (await screen.findByLabelText("Cliente")) as HTMLSelectElement;
    expect([...sel.options].map((o) => [o.value, o.text])).toEqual([
      ["", "Todos los clientes"],
      ["none", "Sin cliente"],
      ["c1", "Acme"],
      ["c2", "Beta"],
    ]);
    fireEvent.change(sel, { target: { value: "c2" } });
    const where = await screen.findByText(/cliente=c2/);
    const u = new URL("http://x" + where.textContent);
    expect(u.searchParams.get("estado")).toBe("publicadas");
    expect(u.searchParams.get("q")).toBe("ana");
    expect(u.searchParams.get("cliente")).toBe("c2");
  });

  it("status chips and the search form keep the client filter", async () => {
    list([item()], { clientFilter: "c1" });
    const sel = (await screen.findByLabelText("Cliente")) as HTMLSelectElement;
    expect(sel.value).toBe("c1");
    const chip = screen.getByRole("link", { name: "Borradores" });
    expect(chip.getAttribute("href")).toBe(
      "/admin?estado=borradores&cliente=c1",
    );
    expect(
      document.querySelector("form[role=search] input[name=cliente]"),
    ).toHaveProperty("value", "c1");
  });

  it("select back to all drops the param", async () => {
    list([item()], { clientFilter: "none" });
    const sel = (await screen.findByLabelText("Cliente")) as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "" } });
    expect((await screen.findByTestId("where")).textContent).toBe("/admin");
  });
});
