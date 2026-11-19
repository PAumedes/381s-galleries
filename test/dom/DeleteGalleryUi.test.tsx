import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import {
  GalleryEditView,
  type GalleryEditData,
} from "../../app/components/admin/GalleryEditView";
import {
  SetupView,
  type SetupViewData,
} from "../../app/components/admin/SetupView";

const edit = {
  gallery: {
    id: "g1",
    title: "Boda Ana",
    slug: "boda-ana",
    clientName: null,
    eventDate: null,
    expires: { date: "", time: "" },
    status: "draft",
    allowHighres: true,
    allowWeb: true,
    allowIg: true,
    allowBulk: true,
    requireEmail: true,
    mode: "delivery",
    palette: "claro",
    coverLayout: "completa",
    gridStyle: "filas",
    gridGap: "normal",
    hasPin: false,
    showOnHome: false,
    coverPhotoId: null,
    coverFocus: null,
  },
  deleting: false,
  hasWmFiles: false,
  hasThumbWmFiles: false,
  photos: [],
  version: "v",
  issues: { groups: [], truncated: 0, total: 0 },
} as unknown as GalleryEditData;

function showEdit(data: Partial<GalleryEditData>, actionData?: unknown) {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      Component: () => (
        <GalleryEditView
          data={{ ...edit, ...data }}
          actionData={actionData as never}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin/g/g1"]} />);
}

describe("delete gallery: danger zone in Datos", () => {
  it("posts intent=delete with a required slug field that names the slug", async () => {
    const { container } = showEdit({});
    const slug = (await screen.findByLabelText(
      /escribí el enlace de la galería \(boda-ana\)/,
    )) as HTMLInputElement;
    expect(slug.name).toBe("slug");
    expect(slug.required).toBe(true);
    const form = slug.closest("form")!;
    expect(
      (form.querySelector("[name=intent]") as HTMLInputElement).value,
    ).toBe("delete");
    expect(form.method).toBe("post");
    expect(
      screen.getByRole("button", { name: "Eliminar galería" }),
    ).toBeTruthy();
    expect(container.textContent).toMatch(/No se puede deshacer/);
    expect(container.textContent).not.toMatch(/continuando/i);
  });
  it("shows 'continuando…' for a deletion left half-done, and the error of a wrong slug", async () => {
    const { container } = showEdit(
      { deleting: true },
      {
        intent: "delete",
        ok: false,
        error: "El enlace que escribiste no coincide. No se eliminó nada.",
      },
    );
    await screen.findByRole("button", { name: "Eliminar galería" });
    expect(container.textContent).toMatch(/Continuando…/);
    expect(screen.getByRole("alert").textContent).toMatch(/no coincide/);
  });
});

const setup: SetupViewData = {
  connected: true,
  mock: false,
  rootName: "Raíz",
  studioName: "381",
  lastSyncAt: null,
  lastError: null,
};
function showSetup(data: Partial<SetupViewData>) {
  const Stub = createRoutesStub([
    {
      path: "/admin/setup",
      Component: () => (
        <SetupView data={{ ...setup, ...data }} actionData={undefined} />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin/setup"]} />);
}

describe("Ajustes: Carpetas ignoradas", () => {
  it("is empty by default", async () => {
    showSetup({});
    expect(await screen.findByText("Carpetas ignoradas")).toBeTruthy();
    expect(screen.getByText("No hay carpetas ignoradas.")).toBeTruthy();
  });
  it("lists each folder with a 'Volver a incluir' form carrying the confirm flag", async () => {
    showSetup({
      ignoredFolders: [
        { handle: "0123456789abcdef", deletedAt: "2026-11-01T12:00:00Z" },
      ],
    });
    const btn = await screen.findByRole("button", { name: "Volver a incluir" });
    const form = btn.closest("form")!;
    const val = (n: string) =>
      (form.querySelector(`[name=${n}]`) as HTMLInputElement).value;
    expect(val("intent")).toBe("reinclude");
    expect(val("handle")).toBe("0123456789abcdef");
    expect(document.body.textContent).not.toContain("0123456789abcdef");
    expect(val("confirm")).toBe("1");
  });
});
