import { fireEvent, render, screen, within } from "@testing-library/react";
import { Outlet, createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEditView } from "../../app/components/admin/clients/ClientEditView";
import { ClientList } from "../../app/components/admin/clients/ClientList";
import { AdminShell } from "../../app/components/admin/AdminShell";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { enAdmin } from "../../app/i18n/en.admin";
import { esAdmin } from "../../app/i18n/es.admin";

const clients = [
  { id: "c1", name: "Acme", slug: "acme", pageEnabled: true, albumCount: 1 },
  { id: "c2", name: "Beta", slug: "beta", pageEnabled: false, albumCount: 3 },
];
const client = {
  id: "c1",
  name: "Acme",
  slug: "acme",
  pageEnabled: true,
  defaultMode: "proofing" as const,
  defaultShowOnHome: true,
};
const albums = [
  {
    id: "g1",
    title: "Boda",
    slug: "boda",
    status: "published" as const,
    mode: "delivery" as const,
  },
];

function stub(
  el: React.ReactElement,
  path = "/admin/clients",
  lang: "es" | "en" = "es",
) {
  const messages = lang === "es" ? es : en;
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang, messages }),
      Component: Outlet,
      children: [
        { path: "admin/clients", Component: () => el },
        { path: "admin/clients/:id", Component: () => el },
      ],
    },
  ]);
  return render(<Stub initialEntries={[path]} />);
}

describe("T6.40b ClientList", () => {
  it("lists clients as links to their edit page with album counts", async () => {
    stub(
      <ClientList clients={clients} message={null} actionData={undefined} />,
    );
    const link = await screen.findByRole("link", { name: /Acme/ });
    expect(link.getAttribute("href")).toBe("/admin/clients/c1");
    expect(within(link).getByText("1 álbum")).toBeTruthy();
    const beta = screen.getByRole("link", { name: /Beta/ });
    expect(within(beta).getByText("3 álbumes")).toBeTruthy();
    expect(within(beta).getByText("Desactivada")).toBeTruthy();
  });

  it("create form: name + optional slug posting intent-less create to the same route", async () => {
    stub(<ClientList clients={[]} message={null} actionData={undefined} />);
    const name = await screen.findByLabelText("Nombre");
    expect(name.getAttribute("name")).toBe("name");
    expect(name.getAttribute("required")).not.toBeNull();
    const slug = screen.getByLabelText("Dirección web");
    expect(slug.getAttribute("name")).toBe("slug");
    expect(slug.getAttribute("required")).toBeNull();
    expect(screen.getByRole("button", { name: "Crear cliente" })).toBeTruthy();
    expect(screen.getByText(/Todavía no hay clientes/)).toBeTruthy();
  });

  it("shows server field errors on the right field and the deleted notice", async () => {
    stub(
      <ClientList
        clients={clients}
        message="Cliente eliminado."
        actionData={{
          intent: "create",
          ok: false,
          error: "Revisá los campos marcados.",
          fieldErrors: { slug: "Esa dirección web ya está en uso." },
        }}
      />,
    );
    expect((await screen.findByRole("status")).textContent).toBe(
      "Cliente eliminado.",
    );
    const slug = screen.getByLabelText("Dirección web");
    expect(slug.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Esa dirección web ya está en uso.")).toBeTruthy();
  });

  it("renders in English", async () => {
    stub(
      <ClientList clients={clients} message={null} actionData={undefined} />,
      "/admin/clients",
      "en",
    );
    expect(
      await screen.findByRole("button", { name: "Create client" }),
    ).toBeTruthy();
    expect(screen.getByText("3 albums")).toBeTruthy();
  });
});

// happy-dom has no window.confirm: install a stub we can spy on.
beforeEach(() => {
  window.confirm = () => true;
});

describe("T6.40b ClientEditView", () => {
  const view = (
    actionData?: Parameters<typeof ClientEditView>[0]["actionData"],
    a = albums,
  ) =>
    stub(
      <ClientEditView
        client={client}
        albums={a}
        publicPage={{ visible: 2, reason: null }}
        actionData={actionData}
      />,
      "/admin/clients/c1",
    );

  it("details form carries the stored values", async () => {
    view();
    expect(
      ((await screen.findByLabelText("Nombre")) as HTMLInputElement).value,
    ).toBe("Acme");
    expect(
      (screen.getByLabelText("Dirección web") as HTMLInputElement).value,
    ).toBe("acme");
    expect(
      (
        screen.getByLabelText(
          "Mostrar la página pública del cliente",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getByLabelText(
          "Mostrar sus álbumes en la portada por defecto",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (screen.getByRole("radio", { name: /Prueba/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      document.querySelector('input[name="intent"][value="save"]'),
    ).not.toBeNull();
  });

  it("lists the client's albums with links, or an empty note", async () => {
    view();
    const link = await screen.findByRole("link", { name: /Boda/ });
    expect(link.getAttribute("href")).toBe("/admin/g/g1");
    expect(
      screen.queryByText("Este cliente todavía no tiene álbumes."),
    ).toBeNull();
  });
  it("empty albums note", async () => {
    view(undefined, []);
    expect(
      await screen.findByText("Este cliente todavía no tiene álbumes."),
    ).toBeTruthy();
  });

  it("apply defaults asks for confirmation and posts confirm=1", async () => {
    view();
    const btn = await screen.findByRole("button", {
      name: "Aplicar a todos los álbumes",
    });
    const form = btn.closest("form")!;
    expect(
      form.querySelector('input[name="intent"]')!.getAttribute("value"),
    ).toBe("applyDefaults");
    expect(
      form.querySelector('input[name="confirm"]')!.getAttribute("value"),
    ).toBe("1");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const ev = new Event("submit", { cancelable: true, bubbles: true });
    form.dispatchEvent(ev);
    expect(confirm).toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
    confirm.mockRestore();
  });

  it("danger zone: typed slug, says albums are unassigned not deleted and old URLs stop", async () => {
    view();
    const input = await screen.findByLabelText(
      "Para confirmar, escribí la dirección del cliente (acme)",
    );
    expect(input.getAttribute("name")).toBe("slug");
    const form = input.closest("form")!;
    expect(
      form.querySelector('input[name="intent"]')!.getAttribute("value"),
    ).toBe("delete");
    expect(within(form).getByText(/NO se eliminan/)).toBeTruthy();
    expect(within(form).getByText(/dejan de funcionar/)).toBeTruthy();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const ev = new Event("submit", { cancelable: true, bubbles: true });
    form.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    confirm.mockRestore();
  });

  it("shows save feedback and the apply warning as a status", async () => {
    view({
      intent: "applyDefaults",
      ok: true,
      message:
        "Valores aplicados a 2 álbumes. Atención: 1 álbum sin preview-wm.",
    });
    expect((await screen.findByRole("status")).textContent).toMatch(/Atención/);
  });

  it("slug error marks the slug field", async () => {
    view({
      intent: "save",
      ok: false,
      error: "Revisá los campos marcados.",
      fieldErrors: { slug: "Esa dirección web ya está en uso." },
    });
    expect(
      (await screen.findByLabelText("Dirección web")).getAttribute(
        "aria-invalid",
      ),
    ).toBe("true");
  });
});

describe("T6.40b admin navigation", () => {
  it("has a Clientes link to /admin/clients", async () => {
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        loader: () => ({ lang: "es", messages: es }),
        Component: Outlet,
        children: [
          {
            path: "admin",
            Component: () => (
              <AdminShell
                status={{
                  mock: true,
                  connected: false,
                  lastSyncAt: null,
                  lastError: null,
                }}
              >
                x
              </AdminShell>
            ),
          },
        ],
      },
    ]);
    render(<Stub initialEntries={["/admin"]} />);
    const link = await screen.findByRole("link", { name: "Clientes" });
    expect(link.getAttribute("href")).toBe("/admin/clients");
    fireEvent.click(link);
  });
});

describe("T6.40b i18n parity", () => {
  it("every admin.clients.* / admin.nav.clients key exists in es and en with the same placeholders", () => {
    const keys = Object.keys(esAdmin).filter(
      (k) => k.startsWith("admin.clients.") || k === "admin.nav.clients",
    );
    expect(keys.length).toBeGreaterThan(30);
    const ph = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of keys) {
      const e = (enAdmin as Record<string, string>)[k];
      expect(e, k).toBeTruthy();
      expect(ph(e!), k).toEqual(ph((esAdmin as Record<string, string>)[k]!));
    }
  });
});

describe("T6.46 public page status line", () => {
  const render46 = (
    publicPage: {
      visible: number;
      capped?: true;
      reason: "disabled" | "none" | null;
    },
    lang: "es" | "en" = "es",
  ) =>
    stub(
      <ClientEditView
        client={client}
        albums={albums}
        publicPage={publicPage}
        actionData={undefined}
      />,
      "/admin/clients/c1",
      lang,
    );

  it("live: shows the public address and the visible count", async () => {
    render46({ visible: 2, reason: null });
    const box = await screen.findByTestId("client-page-status");
    expect(box.textContent).toContain("/acme");
    expect(box.textContent).toContain("Visible: 2 álbumes");
    expect(box.getAttribute("dir")).toBeNull();
  });
  it("capped: shows 1000+ in both languages", async () => {
    render46({ visible: 1000, capped: true, reason: null });
    expect(
      (await screen.findByTestId("client-page-status")).textContent,
    ).toContain("Visible: 1000+ álbumes");
  });
  it("capped, English", async () => {
    render46({ visible: 1000, capped: true, reason: null }, "en");
    expect(
      (await screen.findByTestId("client-page-status")).textContent,
    ).toContain("Visible: 1000+ albums");
  });
  it("singular and English", async () => {
    render46({ visible: 1, reason: null }, "en");
    expect(
      (await screen.findByTestId("client-page-status")).textContent,
    ).toContain("Visible: 1 album");
  });
  it("disabled: says the page is off (404)", async () => {
    render46({ visible: 3, reason: "disabled" });
    expect(
      (await screen.findByTestId("client-page-status")).textContent,
    ).toMatch(/desactivada/i);
  });
  it("none: says there is no published album with a cover", async () => {
    render46({ visible: 0, reason: "none" }, "en");
    expect(
      (await screen.findByTestId("client-page-status")).textContent,
    ).toMatch(/no published album with a cover/i);
  });
  it("the address wraps (no physical direction classes)", async () => {
    render46({ visible: 2, reason: null });
    const box = await screen.findByTestId("client-page-status");
    expect(box.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|text-left|text-right)-/);
  });
});

describe("T6.46 pending feedback on the client forms", () => {
  function pendingStub(el: React.ReactElement) {
    let release!: () => void;
    const gate = new Promise<null>((r) => (release = () => r(null)));
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        loader: () => ({ lang: "es", messages: es }),
        Component: Outlet,
        children: [
          {
            path: "admin/clients",
            Component: () => el,
            action: () => gate,
          },
        ],
      },
    ]);
    render(<Stub initialEntries={["/admin/clients"]} />);
    return release;
  }

  it("create: submit disables the button, shows Creando…, aria-busy, no double submit", async () => {
    const release = pendingStub(
      <ClientList clients={[]} message={null} actionData={undefined} />,
    );
    const name = await screen.findByLabelText("Nombre");
    fireEvent.change(name, { target: { value: "Acme" } });
    const btn = screen.getByRole("button", { name: "Crear cliente" });
    expect(btn.getAttribute("aria-busy")).toBeNull();
    fireEvent.click(btn);
    const busy = await screen.findByRole("button", { name: /Creando/ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.querySelector("[data-spinner]")).not.toBeNull();
    expect(busy.hasAttribute("data-compact")).toBe(true);
    release();
  });
});
