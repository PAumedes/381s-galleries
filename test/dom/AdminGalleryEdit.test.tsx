import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    palette: "claro" as const,
    coverLayout: "completa" as const,
    gridStyle: "filas" as const,
    gridGap: "normal" as const,
    hasPin: false,
    showOnHome: false,
    coverPhotoId: "p1",
    coverFocus: null,
  },
  hasWmFiles: false,
  hasThumbWmFiles: false,
  photoCount: 2,
  wmCount: 0,
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

function show(
  data: Partial<GalleryEditData> = {},
  actionData?: unknown,
  url = "/admin/g/g1",
) {
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
  return render(<Stub initialEntries={[url]} />);
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
    expect(
      (screen.getByLabelText("Dirección web") as HTMLInputElement).value,
    ).toBe("boda-ana");
    // T6.46: the free-text client field is gone (client folders replace it)
    expect(screen.queryByLabelText("Cliente (solo para vos)")).toBeNull();
    expect(document.querySelector('input[name="clientName"]')).toBeNull();
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
    expect(screen.getByText(/Hora local del estudio/)).toBeTruthy();
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
      wmCount: 2,
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
    expect(alert.getAttribute("role")).toBe("status");
  });
  it("T6.19 Prueba with no preview-wm: non-blocking note with the count", async () => {
    show({
      gallery: { ...base.gallery, mode: "proofing" },
      hasWmFiles: false,
      photoCount: 7,
      wmCount: 0,
    });
    const note = await screen.findByText(/ninguna de las 7 fotos/);
    expect(note.getAttribute("role")).toBe("status");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("T6.19 Prueba with some photos lacking preview-wm: N of M note", async () => {
    show({
      gallery: { ...base.gallery, mode: "proofing" },
      hasWmFiles: true,
      hasThumbWmFiles: true,
      photoCount: 10,
      wmCount: 6,
    });
    const note = await screen.findByText(/4 de 10 fotos no tienen preview-wm/);
    expect(note.getAttribute("role")).toBe("status");
    expect(screen.queryByText(/ninguna de las/)).toBeNull();
  });
  it("T6.19 Prueba with every photo watermarked: no count warning", async () => {
    show({
      gallery: { ...base.gallery, mode: "proofing" },
      hasWmFiles: true,
      hasThumbWmFiles: true,
      photoCount: 3,
      wmCount: 3,
    });
    await screen.findByLabelText(/Prueba/);
    expect(screen.queryByText(/no tienen preview-wm/)).toBeNull();
  });
  it("T6.19 switching the Modo radio to Prueba (unsaved) shows the warning at once; back to Entrega hides it", async () => {
    show({ hasWmFiles: true, photoCount: 10, wmCount: 6 });
    expect(screen.queryByText(/no tienen preview-wm/)).toBeNull();
    fireEvent.click(await screen.findByLabelText(/Prueba/));
    expect(
      await screen.findByText(/4 de 10 fotos no tienen preview-wm/),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Entrega/));
    expect(screen.queryByText(/no tienen preview-wm/)).toBeNull();
  });
  it("T6.19 Prueba + shown on the home: reminder; with a watermarked cover available it says so", async () => {
    show({
      gallery: { ...base.gallery, mode: "proofing", showOnHome: true },
      hasWmFiles: true,
      hasThumbWmFiles: true,
      photoCount: 3,
      wmCount: 3,
    });
    const note = await screen.findByText(
      /guardada para mostrarse en la página de inicio.*modo Prueba/,
    );
    expect(note.getAttribute("role")).toBe("status");
  });
  it("T6.19 Prueba + home + no preview-wm: explains the home card needs a watermarked cover", async () => {
    show({
      gallery: { ...base.gallery, mode: "proofing", showOnHome: true },
      hasWmFiles: false,
      photoCount: 3,
      wmCount: 0,
    });
    expect(
      await screen.findByText(/solo si tiene una portada con marca de agua/),
    ).toBeTruthy();
  });
  it("T6.19 no home reminder in Entrega or when not on the home", async () => {
    show({ gallery: { ...base.gallery, showOnHome: true } });
    await screen.findByLabelText(/Prueba/);
    expect(
      screen.queryByText(/guardada para mostrarse en la página de inicio/),
    ).toBeNull();
  });
  it("Prueba with preview-wm but no thumb-wm warns about the heavier grid", async () => {
    show({
      gallery: { ...base.gallery, mode: "proofing" },
      hasWmFiles: true,
      hasThumbWmFiles: false,
      wmCount: 2,
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
      wmCount: 2,
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

  it("sync issues grouped with labels and file names (Fotos panel)", async () => {
    show({}, undefined, "/admin/g/g1?tab=fotos");
    expect(await screen.findByText(/Falta la versión web/)).toBeTruthy();
    expect(screen.getByText(/IMG_9/)).toBeTruthy();
    expect(screen.getByText(/Fiesta/)).toBeTruthy();
  });
  it("T6.53f versioned album: the Fotos panel carries the approvals summary; an unversioned one does not", async () => {
    show(
      { approvals: { approved: 1, total: 2, pending: 1 } },
      undefined,
      "/admin/g/g1?tab=fotos",
    );
    expect(
      await screen.findByText("1 de 2 fotos aprobadas en su última versión"),
    ).toBeTruthy();
    cleanup();
    show({}, undefined, "/admin/g/g1?tab=fotos");
    await screen.findByText(/Falta la versión web/);
    expect(screen.queryByText(/aprobadas en su última versión/)).toBeNull();
  });
  it("no issues: says so (Fotos panel)", async () => {
    show(
      { issues: { groups: [], truncated: 0, total: 0 } },
      undefined,
      "/admin/g/g1?tab=fotos",
    );
    expect(await screen.findByText(/Sin avisos/)).toBeTruthy();
  });

  it("shows feedback for ok actions", async () => {
    show({}, { intent: "pin", ok: true, message: "PIN guardado." });
    expect(await screen.findByText("PIN guardado.")).toBeTruthy();
  });
});

describe("GalleryEditView: Mostrar en la portada", () => {
  const box = async () =>
    (await screen.findByRole("checkbox", {
      name: "Mostrar en la portada",
    })) as HTMLInputElement;
  it("is enabled for a published gallery without PIN", async () => {
    show(gal({ status: "published", showOnHome: true }));
    const b = await box();
    expect(b.disabled).toBe(false);
    expect(b.checked).toBe(true);
    expect(
      b.form!.querySelector('input[name="intent"]')!.getAttribute("value"),
    ).toBe("home");
  });
  it("is disabled with a hint when there is a PIN", async () => {
    show(gal({ status: "published", hasPin: true }));
    const b = await box();
    expect(b.disabled).toBe(true);
    expect(document.body.textContent).toContain("PIN");
    expect(b.getAttribute("aria-describedby")).toBeTruthy();
  });
  it("is disabled with a hint when not published", async () => {
    show(gal({ status: "draft" }));
    expect((await box()).disabled).toBe(true);
    expect(document.body.textContent).toContain("publicada");
  });
});
