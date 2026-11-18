import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import {
  SetupView,
  type SetupViewData,
} from "../../app/components/admin/SetupView";

const base: SetupViewData = {
  connected: false,
  mock: false,
  rootName: null,
  studioName: "381 Studios",
  lastSyncAt: null,
  lastError: null,
};
function show(data: Partial<SetupViewData>, actionData?: unknown) {
  const Stub = createRoutesStub([
    {
      path: "/admin/setup",
      Component: () => (
        <SetupView
          data={{ ...base, ...data }}
          actionData={actionData as never}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin/setup"]} />);
}

describe("SetupView", () => {
  it("not connected: Conectar link, no Desconectar", async () => {
    show({});
    expect(await screen.findByText("No conectado")).toBeTruthy();
    const a = screen.getByRole("link", { name: "Conectar" });
    expect(a.getAttribute("href")).toBe("/admin/google/connect");
    expect(screen.queryByRole("button", { name: "Desconectar" })).toBeNull();
  });
  it("connected: Reconectar + Desconectar, root name shown", async () => {
    show({ connected: true, rootName: "Mi Carpeta" });
    expect(await screen.findByText("Conectado")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reconectar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desconectar" })).toBeTruthy();
    expect(screen.getByText("Mi Carpeta")).toBeTruthy();
  });
  it("mock: demo label, connect disabled", async () => {
    show({ mock: true });
    expect(await screen.findByText("Modo demo (Drive simulado)")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Conectar" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Conectar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("root form warns about archiving and has a maxLength-60 studio input", async () => {
    show({});
    expect(await screen.findByText(/archivar/i)).toBeTruthy();
    const input = screen.getByLabelText(
      "Nombre del estudio",
    ) as HTMLInputElement;
    expect(input.maxLength).toBe(60);
    expect(input.value).toBe("381 Studios");
  });
  it("shows last sync, last error and action errors", async () => {
    show(
      {
        lastSyncAt: "2026-11-16T10:00:00Z",
        lastError: { at: "2026-11-16T11:00:00Z", message: "sync failed" },
      },
      { intent: "root", ok: false, error: "La carpeta no existe." },
    );
    expect(await screen.findByText("La carpeta no existe.")).toBeTruthy();
    expect(screen.getByText(/sync failed/)).toBeTruthy();
  });
  it("shows sync result counts", async () => {
    show(
      {},
      {
        intent: "sync",
        ok: true,
        result: {
          galleries: { created: 2, updated: 1, archived: 0 },
          photos: { added: 30, updated: 0, removed: 0 },
          issues: 3,
          subrequests: 4,
        },
      },
    );
    expect(await screen.findByText(/30 fotos nuevas/)).toBeTruthy();
  });
});

describe("SetupView layout (four cards)", () => {
  it("the four sections are equal cards in a grid: 1 col, 2 at md, 4 at xl", async () => {
    const { container } = show({});
    await screen.findByText("No conectado");
    const grid = container.querySelector("[data-testid=setup-cards]");
    expect(grid).not.toBeNull();
    expect(grid!.className).toMatch(/\bgrid-cols-1\b|\bgrid\b/);
    expect(grid!.className).toContain("md:grid-cols-2");
    expect(grid!.className).toContain("xl:grid-cols-4");
    expect(grid!.className).not.toMatch(/items-start/);
    const cards = Array.from(grid!.children);
    expect(cards).toHaveLength(4);
    for (const c of cards) {
      expect(c.tagName).toBe("SECTION");
      expect(c.className).toMatch(/\bborder\b/);
      expect(c.className).toMatch(/\bp-\d/);
      expect(c.className).toContain("min-w-0");
    }
  });
});
