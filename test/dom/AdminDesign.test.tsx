import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    clientName: null,
    eventDate: "2026-11-01",
    expires: null,
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
    coverPhotoId: "p1",
    coverFocus: null,
  },
  hasWmFiles: true,
  hasThumbWmFiles: true,
  photos: [{ id: "p1", set: "Highlights", name: "IMG_1", takenAt: null }],
  version: "v1",
  issues: { groups: [], truncated: 0, total: 0 },
};

function show(
  over: Partial<GalleryEditData["gallery"]> = {},
  actionData?: never,
) {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      Component: () => (
        <GalleryEditView
          data={{ ...base, gallery: { ...base.gallery, ...over } }}
          actionData={actionData}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin/g/g1"]} />);
}
const preview = () => screen.findByTestId("cover-preview");
const section = async () =>
  (await screen.findByRole("heading", { name: "Diseño" })).closest("section")!;

describe("Diseño section", () => {
  it("has four groups of radio cards with the owner's options, prefilled", async () => {
    show({
      palette: "arena",
      coverLayout: "dividida",
      gridStyle: "columnas",
      gridGap: "amplio",
    });
    const s = await section();
    const group = (name: string) => within(s).getByRole("radiogroup", { name });
    const opts = (name: string) =>
      within(group(name))
        .getAllByRole("radio")
        .map((r) => ({
          label: (r as HTMLInputElement).labels?.[0]?.textContent?.trim(),
          value: (r as HTMLInputElement).value,
          name: (r as HTMLInputElement).name,
          checked: (r as HTMLInputElement).checked,
        }));
    expect(opts("Paleta").map((o) => [o.label, o.value, o.checked])).toEqual([
      ["Claro", "claro", false],
      ["Oscuro", "oscuro", false],
      ["Arena", "arena", true],
      ["Gris", "gris", false],
    ]);
    expect(opts("Portada").map((o) => [o.label, o.value, o.checked])).toEqual([
      ["Completa", "completa", false],
      ["Dividida", "dividida", true],
      ["Centrada", "centrada", false],
      ["Mínima", "minima", false],
    ]);
    expect(opts("Grilla").map((o) => [o.label, o.value, o.checked])).toEqual([
      ["Filas", "filas", false],
      ["Cuadrícula", "cuadricula", false],
      ["Columnas", "columnas", true],
    ]);
    expect(opts("Espaciado").map((o) => [o.label, o.value, o.checked])).toEqual(
      [
        ["Compacto", "compacto", false],
        ["Normal", "normal", false],
        ["Amplio", "amplio", true],
      ],
    );
    expect(opts("Paleta")[0].name).toBe("palette");
    expect(opts("Portada")[0].name).toBe("coverLayout");
    expect(opts("Grilla")[0].name).toBe("gridStyle");
    expect(opts("Espaciado")[0].name).toBe("gridGap");
  });

  it("every card has a CSS/SVG schematic (no <img>)", async () => {
    show();
    const s = await section();
    const radios = within(s).getAllByRole("radio");
    expect(radios).toHaveLength(14);
    for (const r of radios) {
      const card = (r as HTMLInputElement).labels![0];
      expect(card.querySelector("[data-thumb]")).toBeTruthy();
      expect(card.querySelector("img")).toBeNull();
    }
  });

  it("posts intent=design with the four fields", async () => {
    show();
    const s = await section();
    const form = s.querySelector("form")!;
    expect(
      (form.querySelector('input[name="intent"]') as HTMLInputElement).value,
    ).toBe("design");
    expect(
      within(form).getByRole("button", { name: "Guardar diseño" }),
    ).toBeTruthy();
    expect(form.querySelectorAll('input[type="radio"]:checked')).toHaveLength(
      4,
    );
  });

  it("choosing a palette / layout updates the live CoverHero preview instantly", async () => {
    show();
    const el = await preview();
    expect(el.querySelector('[data-theme="claro"]')).toBeTruthy();
    expect(el.querySelector('[data-cover-layout="completa"]')).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Arena"));
    expect(el.querySelector('[data-theme="arena"]')).toBeTruthy();
    expect(el.querySelector('[data-theme="claro"]')).toBeNull();
    await userEvent.click(screen.getByLabelText("Dividida"));
    expect(el.querySelector('[data-cover-layout="dividida"]')).toBeTruthy();
    expect(el.querySelector('[data-cover-pane="text"]')).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Mínima"));
    expect(el.querySelector("img[data-cover-img]")).toBeNull();
    await userEvent.click(screen.getByLabelText("Oscuro"));
    expect(el.querySelector('[data-theme="oscuro"]')).toBeTruthy();
  });

  it("shows a validation error from the server next to the group", async () => {
    show({}, {
      intent: "design",
      ok: false,
      error: "Revisá los campos marcados.",
      fieldErrors: { palette: "Paleta inválida." },
    } as never);
    expect(
      (await screen.findByText("Paleta inválida.")).getAttribute("role"),
    ).toBe("alert");
  });

  it("the old Tema select is gone from Opciones", async () => {
    show();
    await section();
    expect(screen.queryByLabelText("Tema")).toBeNull();
  });
});
