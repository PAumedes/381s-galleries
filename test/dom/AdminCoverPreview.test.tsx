import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";
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
    expires: null,
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
    coverPhotoId: "p2",
    coverFocus: null,
  },
  hasWmFiles: true,
  hasThumbWmFiles: true,
  photos: [
    { id: "p1", set: "Highlights", name: "IMG_1", takenAt: null },
    { id: "p2", set: "Highlights", name: "IMG_2", takenAt: null },
    { id: "p3", set: "Fiesta", name: "IMG_3", takenAt: null },
  ],
  version: "v1",
  issues: { groups: [], truncated: 0, total: 0 },
};

// The cover editor lives in the "Portada" panel of the editor.
function show(
  gallery: Partial<GalleryEditData["gallery"]> = {},
  extra: Partial<GalleryEditData> = {},
  url = "/admin/g/g1?tab=portada",
) {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      Component: () => (
        <GalleryEditView
          data={{ ...base, ...extra, gallery: { ...base.gallery, ...gallery } }}
          actionData={undefined}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={[url]} />);
}
const preview = async () => screen.findByTestId("cover-preview");
const previewImg = (el: HTMLElement) =>
  el.querySelector("img[data-cover-img]")!;
const frame = () => screen.getByTestId("focus-picker");
function sizeFrame() {
  vi.spyOn(frame(), "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 50,
    width: 200,
    height: 100,
    right: 300,
    bottom: 150,
    x: 100,
    y: 50,
    toJSON() {},
  });
}
const hidden = (name: string) =>
  (
    screen
      .getByRole("button", { name: "Guardar punto focal" })
      .closest("form")!
      .querySelector(`input[name=${name}]`) as HTMLInputElement
  ).value;

describe("single Fotos panel (no duplicate grids)", () => {
  const fotos = (g: Partial<GalleryEditData["gallery"]> = {}) =>
    show(g, {}, "/admin/g/g1?tab=fotos");
  it("renders exactly one tile (thumb) per photo and no radio cover picker", async () => {
    fotos();
    await screen.findByRole("heading", { name: "Fotos" });
    for (const id of ["p1", "p2", "p3"])
      expect(
        document.querySelectorAll(`img[src="/admin/img/${id}/thumb"]`),
      ).toHaveLength(1);
    expect(
      document.querySelectorAll("input[type=radio][name=photoId]"),
    ).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Portada" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Orden de las fotos" }),
    ).toBeNull();
  });
  it("marks the current cover with a badge and offers 'Usar como portada' on the others", async () => {
    fotos();
    await screen.findByRole("heading", { name: "Fotos" });
    const tiles = Array.from(document.querySelectorAll("[data-photo-id]"));
    const p2 = tiles.find((t) => t.getAttribute("data-photo-id") === "p2")!;
    const p1 = tiles.find((t) => t.getAttribute("data-photo-id") === "p1")!;
    expect(p2.querySelector('[data-cover-badge="desktop"]')).toBeTruthy();
    expect(p1.querySelector("[data-cover-badge]")).toBeNull();
    const use = within(p1 as HTMLElement).getByRole("button", {
      name: "Usar como portada",
    });
    const form = use.closest("form")!;
    expect(form.method).toBe("post");
    expect(
      (form.querySelector("input[name=intent]") as HTMLInputElement).value,
    ).toBe("cover");
    expect(
      (form.querySelector("input[name=photoId]") as HTMLInputElement).value,
    ).toBe("p1");
  });
  it("automatic cover: the first photo wears the badge and can be pinned", async () => {
    fotos({ coverPhotoId: null });
    await screen.findByRole("heading", { name: "Fotos" });
    const p1 = document.querySelector('[data-photo-id="p1"]') as HTMLElement;
    expect(
      p1.querySelector('[data-cover-badge="desktop"]')!.getAttribute("title"),
    ).toBe("Portada automática (primera foto)");
    const pin = within(p1).getByRole("button", { name: "Usar como portada" });
    expect(
      (
        pin
          .closest("form")!
          .querySelector("input[name=photoId]") as HTMLInputElement
      ).value,
    ).toBe("p1");
  });
  it("keeps 'Usar la primera foto' (automatic cover) in the Portada panel", async () => {
    show();
    await preview();
    const b = screen.getByRole("button", { name: "Usar la primera foto" });
    expect(
      (
        b
          .closest("form")!
          .querySelector("input[name=photoId]") as HTMLInputElement
      ).value,
    ).toBe("");
  });
});

describe("cover preview", () => {
  it("renders title, date, studio, theme and the clean view-sm in Entrega", async () => {
    show();
    const el = await preview();
    expect(within(el).getByText("Boda Ana")).toBeTruthy();
    expect(within(el).getByText(/1 de noviembre de 2026/)).toBeTruthy();
    expect(within(el).getByText("381 Studios")).toBeTruthy();
    expect(previewImg(el).getAttribute("src")).toBe("/admin/img/p2/view-sm");
    expect(el.querySelector('[data-theme="claro"]')).toBeTruthy();
  });
  it("Prueba uses the watermarked variant; switching the mode radio updates it live", async () => {
    // The mode radios live in Datos, next to the same live preview.
    show({ mode: "proofing" }, {}, "/admin/g/g1");
    const el = await screen.findByTestId("live-preview");
    expect(previewImg(el).getAttribute("src")).toBe("/admin/img/p2/view-sm-wm");
    await userEvent.click(screen.getByLabelText("Entrega"));
    expect(previewImg(el).getAttribute("src")).toBe("/admin/img/p2/view-sm");
    await userEvent.click(screen.getByLabelText("Prueba"));
    expect(previewImg(el).getAttribute("src")).toBe("/admin/img/p2/view-sm-wm");
  });
  it("falls back to the first photo when the cover is automatic", async () => {
    show({ coverPhotoId: null });
    expect(previewImg(await preview()).getAttribute("src")).toBe(
      "/admin/img/p1/view-sm",
    );
  });
  it("oscuro palette and live title/date edits", async () => {
    show({ palette: "oscuro" }, {}, "/admin/g/g1?tab=diseno");
    let el = await screen.findByTestId("live-preview");
    expect(el.querySelector('[data-theme="oscuro"]')).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Claro"));
    expect(el.querySelector('[data-theme="claro"]')).toBeTruthy();
    cleanup();
    show({}, {}, "/admin/g/g1");
    el = await screen.findByTestId("live-preview");
    const title = screen.getByLabelText("Título");
    await userEvent.clear(title);
    await userEvent.type(title, "Nuevo");
    expect(within(el).getByText("Nuevo")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Fecha del evento"), {
      target: { value: "2027-01-02" },
    });
    expect(within(el).getByText(/2 de enero de 2027/)).toBeTruthy();
  });
  it("no photos: placeholder, no image, still shows the title", async () => {
    show({ coverPhotoId: null }, { photos: [] });
    const el = await preview();
    expect(el.querySelector("img[data-cover-img]")).toBeNull();
    expect(within(el).getByText("Boda Ana")).toBeTruthy();
  });
  it("desktop/mobile toggle switches the frame between 16:9 and 9:19", async () => {
    show();
    await preview();
    const pv = () => document.querySelector("[data-frame]") as HTMLElement;
    expect(pv().getAttribute("data-frame")).toBe("desktop");
    expect(pv().style.aspectRatio.replace(/\s/g, "")).toBe("16/9");
    const mobile = screen.getByRole("button", { name: "Móvil" });
    await userEvent.click(mobile);
    expect(mobile.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Escritorio" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(pv().getAttribute("data-frame")).toBe("mobile");
    expect(pv().style.aspectRatio.replace(/\s/g, "")).toBe("9/19");
  });
  it("is not part of the details form (no stray fields submitted)", async () => {
    show();
    const el = await preview();
    expect(el.closest("form")).toBeNull();
  });
});

describe("cover focal point", () => {
  it("starts centered (no object-position override beyond center) and nothing to save as x/y", async () => {
    show();
    const el = await preview();
    expect(previewImg(el).style.objectPosition).toBe("50% 50%");
    expect(hidden("focusX")).toBe("");
    expect(hidden("focusY")).toBe("");
  });
  it("uses the stored focus (a point on the image; object-position needs a measured frame)", async () => {
    show({ coverFocus: { x: 10, y: 90 } });
    const el = await preview();
    expect(previewImg(el).style.objectPosition).toBe("50% 50%");
    expect(hidden("focusX")).toBe("10");
    expect(hidden("focusY")).toBe("90");
  });
  it("click sets x,y as percentages of the image", async () => {
    show();
    await preview();
    sizeFrame();
    fireEvent.click(frame(), { clientX: 150, clientY: 125 });
    expect(hidden("focusX")).toBe("25");
    expect(hidden("focusY")).toBe("75");
    expect((screen.getByTestId("focus-marker") as HTMLElement).style.left).toBe(
      "25%",
    );
  });
  it("clicks outside the frame clamp to 0-100", async () => {
    show();
    await preview();
    sizeFrame();
    fireEvent.click(frame(), { clientX: -500, clientY: 9999 });
    expect(hidden("focusX")).toBe("0");
    expect(hidden("focusY")).toBe("100");
  });
  it("arrow keys move by 5 from the center and clamp", async () => {
    show();
    await preview();
    const f = frame();
    f.focus();
    fireEvent.keyDown(f, { key: "ArrowRight" });
    expect([hidden("focusX"), hidden("focusY")]).toEqual(["55", "50"]);
    fireEvent.keyDown(f, { key: "ArrowUp" });
    expect([hidden("focusX"), hidden("focusY")]).toEqual(["55", "45"]);
    fireEvent.keyDown(f, { key: "ArrowLeft" });
    fireEvent.keyDown(f, { key: "ArrowDown" });
    expect([hidden("focusX"), hidden("focusY")]).toEqual(["50", "50"]);
    for (let i = 0; i < 30; i++) fireEvent.keyDown(f, { key: "ArrowRight" });
    expect(hidden("focusX")).toBe("100");
    for (let i = 0; i < 30; i++) fireEvent.keyDown(f, { key: "ArrowUp" });
    expect(hidden("focusY")).toBe("0");
  });
  it("a11y: application role, label, aria-valuetext, polite live region, focus kept after save", async () => {
    show();
    await preview();
    const f = frame();
    expect(f.getAttribute("role")).toBe("application");
    expect(f.getAttribute("aria-label")).toMatch(/Punto focal/);
    expect(f.getAttribute("aria-valuetext")).toBe(
      "Punto focal: 50% horizontal, 50% vertical",
    );
    f.focus();
    fireEvent.keyDown(f, { key: "ArrowRight" });
    expect(f.getAttribute("aria-valuetext")).toBe(
      "Punto focal: 55% horizontal, 50% vertical",
    );
    const live = within(screen.getByTestId("cover-preview")).getByRole(
      "status",
    );
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toContain("55% horizontal");
    expect(document.activeElement).toBe(f);
  });
  it("arrow steps are rounded to one decimal", async () => {
    show();
    await preview();
    sizeFrame();
    fireEvent.click(frame(), { clientX: 100 + 200 * 0.053, clientY: 100 });
    fireEvent.keyDown(frame(), { key: "ArrowLeft" });
    expect(hidden("focusX")).toBe("0.3");
  });
  it("the picker is keyboard focusable and other keys are ignored", async () => {
    show();
    await preview();
    expect(frame().getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(frame(), { key: "a" });
    expect(hidden("focusX")).toBe("");
  });
  it("'Centrar' clears the focus; the save form posts intent=focus", async () => {
    show({ coverFocus: { x: 10, y: 90 } });
    const el = await preview();
    const form = screen
      .getByRole("button", { name: "Guardar punto focal" })
      .closest("form")!;
    expect(form.method).toBe("post");
    expect(
      (form.querySelector("input[name=intent]") as HTMLInputElement).value,
    ).toBe("focus");
    await userEvent.click(screen.getByRole("button", { name: "Centrar" }));
    expect(previewImg(el).style.objectPosition).toBe("50% 50%");
    expect(hidden("focusX")).toBe("");
  });
});
