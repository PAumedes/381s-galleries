import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import {
  GalleryEditView,
  type GalleryEditData,
} from "../../app/components/admin/GalleryEditView";

const base: GalleryEditData = {
  gallery: {
    id: "g1",
    title: "Boda Ana",
    slug: "boda-ana",
    clientName: "Ana",
    eventDate: "2026-11-01",
    expires: { date: "2026-12-24", time: "18:30" },
    status: "draft",
    allowHighres: true,
    allowWeb: true,
    allowIg: false,
    allowBulk: true,
    requireEmail: true,
    mode: "delivery" as const,
    theme: "light" as const,
    hasPin: false,
    coverPhotoId: "p1",
    coverFocus: null,
  },
  hasWmFiles: false,
  hasThumbWmFiles: false,
  photos: [
    { id: "p1", set: "Highlights", name: "IMG_1", takenAt: null },
    { id: "p2", set: "Highlights", name: "IMG_2", takenAt: null },
  ],
  version: "v1",
  issues: {
    groups: [
      {
        type: "missing_web",
        label: "Falta la versión web",
        items: [{ set: "Fiesta", name: "IMG_9" }],
      },
    ],
    truncated: 0,
    total: 1,
  },
};

function show(data: Partial<GalleryEditData> = {}, actionData?: unknown) {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      Component: () => (
        <GalleryEditView
          data={{ ...base, ...data }}
          actionData={actionData as never}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin/g/g1"]} />);
}
const gal = (over: Partial<GalleryEditData["gallery"]>) => ({
  gallery: { ...base.gallery, ...over },
});

describe("GalleryEditView", () => {
  it("prefills the details form with maxLength constraints and a slug warning", async () => {
    show();
    const title = (await screen.findByLabelText("Título")) as HTMLInputElement;
    expect(title.value).toBe("Boda Ana");
    expect(title.maxLength).toBe(120);
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(
      "boda-ana",
    );
    expect(
      (screen.getByLabelText("Cliente (solo para vos)") as HTMLInputElement)
        .maxLength,
    ).toBe(120);
    expect(
      (screen.getByLabelText("Fecha del evento") as HTMLInputElement).type,
    ).toBe("date");
    expect(
      (screen.getByLabelText("Vence (fecha)") as HTMLInputElement).value,
    ).toBe("2026-12-24");
    expect(
      (screen.getByLabelText("Vence (hora)") as HTMLInputElement).value,
    ).toBe("18:30");
    expect(screen.getByText(/dejarán de funcionar/)).toBeTruthy();
    expect(screen.getByText(/Buenos Aires/)).toBeTruthy();
  });

  it("shows inline Spanish field errors next to the field", async () => {
    show(
      {},
      {
        intent: "details",
        ok: false,
        error: "Revisá los campos marcados.",
        fieldErrors: {
          title: "El título debe tener entre 1 y 120 caracteres.",
          slug: "Ese slug ya está en uso.",
          expires: "La fecha de vencimiento no es válida.",
        },
      },
    );
    const title = (await screen.findByLabelText("Título")) as HTMLInputElement;
    expect(title.getAttribute("aria-invalid")).toBe("true");
    const msg = screen.getByText(
      "El título debe tener entre 1 y 120 caracteres.",
    );
    expect(msg.getAttribute("role")).toBe("alert");
    expect(title.getAttribute("aria-describedby")).toContain(msg.id);
    expect(screen.getByText("Ese slug ya está en uso.")).toBeTruthy();
    expect(
      screen.getByText("La fecha de vencimiento no es válida."),
    ).toBeTruthy();
    expect(
      (
        screen.getByLabelText("Cliente (solo para vos)") as HTMLInputElement
      ).getAttribute("aria-invalid"),
    ).toBeNull();
  });

  it("status buttons depend on the current status", async () => {
    const { unmount } = show();
    await screen.findByLabelText("Título");
    const names = () =>
      screen
        .getAllByRole("button")
        .map((b) => b.textContent)
        .filter((t) =>
          ["Publicar", "Pasar a borrador", "Archivar", "Restaurar"].includes(
            t!,
          ),
        );
    expect(names()).toEqual(["Publicar", "Archivar"]);
    unmount();
    show(gal({ status: "published" }));
    await screen.findByLabelText("Título");
    expect(names()).toEqual(["Pasar a borrador", "Archivar"]);
  });
  it("archived: only Restaurar", async () => {
    show(gal({ status: "archived" }));
    await screen.findByLabelText("Título");
    expect(screen.getByRole("button", { name: "Restaurar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publicar" })).toBeNull();
  });

  it("PIN: never shows the value; says PIN activo and warns about sessions", async () => {
    show(gal({ hasPin: true }));
    await screen.findByLabelText("Título");
    expect(screen.getByText("PIN activo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quitar PIN" })).toBeTruthy();
    expect(screen.getByText(/cierra las sesiones/)).toBeTruthy();
    const pin = screen.getByLabelText("Nuevo PIN") as HTMLInputElement;
    expect(pin.value).toBe("");
    expect(pin.minLength).toBe(6);
    expect(pin.maxLength).toBe(32);
    expect(screen.getByRole("button", { name: "Cambiar PIN" })).toBeTruthy();
  });
  it("PIN: none set", async () => {
    show();
    await screen.findByLabelText("Título");
    expect(screen.getByText("Sin PIN")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Quitar PIN" })).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar PIN" })).toBeTruthy();
  });

  it("Modo selector: Prueba / Entrega with a one-line explanation each", async () => {
    show();
    const entrega = (await screen.findByLabelText(
      /Entrega/,
    )) as HTMLInputElement;
    const prueba = screen.getByLabelText(/Prueba/) as HTMLInputElement;
    expect(entrega.name).toBe("mode");
    expect(prueba.name).toBe("mode");
    expect(entrega.value).toBe("delivery");
    expect(prueba.value).toBe("proofing");
    expect(entrega.checked).toBe(true);
    expect(prueba.checked).toBe(false);
    expect(screen.getByText(/con marca de agua y sin descargas/i)).toBeTruthy();
    expect(
      screen.getByText(/sin marca de agua y con las descargas/i),
    ).toBeTruthy();
  });
  it("Entrega: size/download checkboxes enabled, no note", async () => {
    show();
    expect(
      ((await screen.findByLabelText(/Alta resolución/)) as HTMLInputElement)
        .disabled,
    ).toBe(false);
    expect(screen.queryByText(/En modo Prueba no hay descargas/)).toBeNull();
  });
  it("Prueba: size/download checkboxes disabled with a note; email stays enabled", async () => {
    show({
      gallery: { ...base.gallery, mode: "proofing" },
      hasWmFiles: true,
      hasThumbWmFiles: true,
    });
    for (const re of [
      /Alta resolución/,
      /Web \(1200/,
      /Instagram/,
      /descargar todo/,
    ]) {
      expect(
        ((await screen.findByLabelText(re)) as HTMLInputElement).disabled,
      ).toBe(true);
    }
    expect(screen.getByText(/En modo Prueba no hay descargas/)).toBeTruthy();
    expect(
      (screen.getByLabelText(/Pedir email/) as HTMLInputElement).disabled,
    ).toBe(false);
    expect((screen.getByLabelText(/Prueba/) as HTMLInputElement).checked).toBe(
      true,
    );
  });
  it("Prueba without preview-wm warns", async () => {
    show({ gallery: { ...base.gallery, mode: "proofing" }, hasWmFiles: false });
    const alert = await screen.findByText(/no tiene archivos preview-wm/);
    expect(alert.getAttribute("role")).toBe("alert");
  });
  it("Prueba with preview-wm but no thumb-wm warns about the heavier grid", async () => {
    show({
      gallery: { ...base.gallery, mode: "proofing" },
      hasWmFiles: true,
      hasThumbWmFiles: false,
    });
    expect(
      await screen.findByText(
        /la grilla usará la vista de 2048 px, más pesada/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/no tiene archivos preview-wm/)).toBeNull();
  });
  it("Prueba with both recipes: no warnings", async () => {
    show({
      gallery: { ...base.gallery, mode: "proofing" },
      hasWmFiles: true,
      hasThumbWmFiles: true,
    });
    await screen.findByLabelText(/Prueba/);
    expect(screen.queryByText(/no tiene archivos preview-wm/)).toBeNull();
    expect(screen.queryByText(/más pesada/)).toBeNull();
  });
  it("Entrega never shows the wm warnings", async () => {
    show({ hasWmFiles: false });
    await screen.findByLabelText(/Entrega/);
    expect(screen.queryByText(/no tiene archivos preview-wm/)).toBeNull();
  });
  it("flag checkboxes reflect state", async () => {
    show();
    expect(
      ((await screen.findByLabelText(/Alta resolución/)) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText(/Instagram/) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByLabelText(/Pedir email/) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("theme select: Claro/Oscuro in Opciones, prefilled", async () => {
    show(gal({ theme: "dark" }));
    const sel = (await screen.findByLabelText("Tema")) as HTMLSelectElement;
    expect(sel.name).toBe("theme");
    expect(sel.value).toBe("dark");
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual([
      "Claro",
      "Oscuro",
    ]);
  });

  it("sync issues grouped with labels and file names", async () => {
    show();
    expect(await screen.findByText(/Falta la versión web/)).toBeTruthy();
    expect(screen.getByText(/IMG_9/)).toBeTruthy();
    expect(screen.getByText(/Fiesta/)).toBeTruthy();
  });
  it("no issues: says so", async () => {
    show({ issues: { groups: [], truncated: 0, total: 0 } });
    expect(await screen.findByText(/Sin avisos/)).toBeTruthy();
  });

  it("shows feedback for ok actions", async () => {
    show({}, { intent: "pin", ok: true, message: "PIN guardado." });
    expect(await screen.findByText("PIN guardado.")).toBeTruthy();
  });
});
