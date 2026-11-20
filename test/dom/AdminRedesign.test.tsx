import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GalleryEditView,
  type GalleryEditData,
} from "../../app/components/admin/GalleryEditView";
import { PhotoReorder } from "../../app/components/admin/PhotoReorder";
import { AdminGalleryPreview } from "../../app/components/admin/AdminGalleryPreview";
import { CoverHero } from "../../app/components/CoverHero";

const photos = [
  {
    id: "p1",
    set: "Ceremonia",
    name: "IMG_1",
    takenAt: null,
    width: 3000,
    height: 2000,
  },
  {
    id: "p2",
    set: "Ceremonia",
    name: "IMG_2",
    takenAt: null,
    width: 2000,
    height: 3000,
  },
  {
    id: "p3",
    set: "Ceremonia",
    name: "IMG_3",
    takenAt: null,
    width: 2000,
    height: 3000,
  },
  {
    id: "p4",
    set: "Fiesta",
    name: "IMG_4",
    takenAt: null,
    width: 3000,
    height: 2000,
  },
];

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
    coverPhotoId: "p2",
    coverFocus: null,
    coverPhotoIdMobile: null,
    coverFocusMobile: null,
  },
  hasWmFiles: true,
  hasThumbWmFiles: true,
  photos,
  version: "v1",
  issues: { groups: [], truncated: 0, total: 0 },
};

function show(
  url = "/admin/g/g1",
  gallery: Partial<GalleryEditData["gallery"]> = {},
  extra: Partial<GalleryEditData> = {},
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

function reorder(props: Partial<Parameters<typeof PhotoReorder>[0]> = {}) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <PhotoReorder
          photos={photos}
          version="v1"
          coverPhotoId="p2"
          {...props}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}
/** Components that read root loader data need a data router around them. */
function inRouter(el: React.ReactElement) {
  const Stub = createRoutesStub([{ path: "/", Component: () => el }]);
  return render(<Stub initialEntries={["/"]} />);
}
const tile = (id: string) =>
  document.querySelector(`[data-photo-id="${id}"]`) as HTMLElement;

afterEach(() => vi.restoreAllMocks());
// The editor remembers its device in sessionStorage: start every test clean.
beforeEach(() => sessionStorage.clear());

describe("Fotos: cover indicator only once", () => {
  it("shows exactly one desktop cover badge, on the cover photo, and no cover text on the others", async () => {
    reorder();
    const badges = document.querySelectorAll('[data-cover-badge="desktop"]');
    expect(badges).toHaveLength(1);
    expect(tile("p2").contains(badges[0]!)).toBe(true);
    // No long sentence repeated on every tile.
    expect(screen.queryAllByText(/Portada \(automática\)/)).toHaveLength(0);
    expect(screen.queryAllByText("Fijar portada")).toHaveLength(0);
    // The cover tile does not offer to become the cover again.
    expect(
      within(tile("p2")).queryByRole("button", { name: /Usar como portada$/ }),
    ).toBeNull();
  });

  it("automatic cover: the badge sits on the first photo and says so in its label", async () => {
    reorder({ coverPhotoId: "p1", coverAuto: true });
    const badge = document.querySelector('[data-cover-badge="desktop"]')!;
    expect(tile("p1").contains(badge)).toBe(true);
    expect(badge.getAttribute("title")).toBe(
      "Portada automática (primera foto)",
    );
    expect(document.querySelectorAll("[data-cover-badge]")).toHaveLength(1);
  });

  it("other tiles keep 'Usar como portada' in the always-visible action bar under the picture (T6.18)", async () => {
    reorder();
    const actions = tile("p1").querySelector(
      "[data-tile-actions]",
    ) as HTMLElement;
    expect(actions.className).not.toMatch(/\binvisible\b/);
    expect(actions.closest("[data-thumb-frame]")).toBeNull();
    const use = within(actions).getByRole("button", {
      name: "Usar como portada",
    });
    const form = use.closest("form")!;
    expect(
      (form.querySelector("input[name=intent]") as HTMLInputElement).value,
    ).toBe("cover");
    expect(
      (form.querySelector("input[name=photoId]") as HTMLInputElement).value,
    ).toBe("p1");
    expect(form.querySelector("input[name=device]")).toBeNull();
  });

  it("a selected tile (tap) shows its actions", async () => {
    reorder();
    await userEvent.click(
      within(tile("p3")).getByRole("button", { name: "IMG_3" }),
    );
    const actions = tile("p3").querySelector(
      "[data-tile-actions]",
    ) as HTMLElement;
    expect(actions.className).not.toMatch(/(^|\s)invisible(\s|$)/);
  });

  it("marks the mobile cover once with its own badge and offers 'Usar como portada móvil' elsewhere", async () => {
    reorder({ mobileCoverId: "p3" });
    const m = document.querySelectorAll('[data-cover-badge="mobile"]');
    expect(m).toHaveLength(1);
    expect(tile("p3").contains(m[0]!)).toBe(true);
    const btn = within(tile("p1")).getByRole("button", {
      name: "Usar como portada móvil",
    });
    const form = btn.closest("form")!;
    expect(
      (form.querySelector("input[name=device]") as HTMLInputElement).value,
    ).toBe("mobile");
    expect(
      within(tile("p3")).queryByRole("button", {
        name: "Usar como portada móvil",
      }),
    ).toBeNull();
  });
});

describe("Fotos: uniform thumbnail grid + full view", () => {
  it("every tile is a fixed 4:3 box showing the whole photo (object-contain)", () => {
    reorder();
    const lists = document.querySelectorAll("ul[data-set]");
    expect(lists).toHaveLength(2);
    for (const id of ["p1", "p2", "p3", "p4"]) {
      const img = tile(id).querySelector(
        `img[src="/admin/img/${id}/thumb"]`,
      ) as HTMLElement;
      expect(img.className).toMatch(/object-contain/);
      expect(img.closest("[data-thumb-frame]")!.className).toMatch(
        /aspect-\[4\/3\]/,
      );
    }
  });

  it("'Ver completa' opens a lightbox with the whole photo; Escape and arrows work", async () => {
    reorder();
    await userEvent.click(
      within(tile("p2")).getByRole("button", { name: "Ver completa" }),
    );
    const dlg = screen.getByRole("dialog", { name: "IMG_2" });
    const img = within(dlg).getByRole("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/admin/img/p2/view-sm");
    expect(img.className).toMatch(/object-contain/);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: "IMG_3" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reordering still works: select, Mover después, Guardar orden enabled", async () => {
    reorder();
    await userEvent.click(
      within(tile("p1")).getByRole("button", { name: "IMG_1" }),
    );
    const fs = tile("p1").closest("fieldset")!;
    await userEvent.click(
      within(fs).getByRole("button", { name: "Mover después" }),
    );
    const order = document.querySelector(
      "input[name=order]",
    ) as HTMLInputElement;
    expect(JSON.parse(order.value).Ceremonia).toEqual(["p2", "p1", "p3"]);
    expect(
      (
        screen.getByRole("button", {
          name: "Guardar orden",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});

describe("editor sections and layout", () => {
  it("one gallery nav: Datos, Fotos, Portada, Diseño, Compartir, Actividad, Favoritos", () => {
    show();
    const nav = screen.getByRole("navigation", {
      name: "Secciones de la galería",
    });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      "Datos",
      "Fotos",
      "Portada",
      "Diseño",
      "Compartir",
      "Actividad",
      "Favoritos",
    ]);
    expect(links[0]!.getAttribute("aria-current")).toBe("page");
    expect(links[1]!.getAttribute("href")).toBe("/admin/g/g1?tab=fotos");
  });

  it("?tab=fotos shows the photo grid full width (no preview column)", () => {
    show("/admin/g/g1?tab=fotos");
    expect(document.querySelector("ul[data-set]")).toBeTruthy();
    expect(screen.queryByTestId("live-preview")).toBeNull();
    expect(screen.queryByLabelText("Título")).toBeNull();
  });

  it("Datos has the forms on the left and a sticky live preview column on the right at lg", () => {
    show();
    const grid = document.querySelector("[data-editor-grid]") as HTMLElement;
    expect(grid.className).toMatch(/lg:grid-cols-/);
    const aside = grid.querySelector("[data-preview-column]") as HTMLElement;
    expect(aside.className).toMatch(/lg:sticky/);
    expect(within(aside).getByTestId("live-preview")).toBeTruthy();
    expect(screen.getByLabelText("Título")).toBeTruthy();
  });

  it("'Vista previa' opens the admin preview of the real gallery in a new tab", () => {
    show();
    const a = screen.getByRole("link", { name: /Vista previa/ });
    expect(a.getAttribute("href")).toBe("/admin/g/g1/preview?device=desktop");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toMatch(/noopener/);
  });
});

describe("Portada: two clearly different cards", () => {
  it("'1. Elegí el punto focal' (whole photo + crosshair) and '2. Así se ve' (real cover + device switch)", () => {
    show("/admin/g/g1?tab=portada");
    const pick = screen.getByRole("region", {
      name: "1. Elegí el punto focal",
    });
    const see = screen.getByRole("region", { name: "2. Así se ve" });
    expect(within(pick).getByTestId("focus-picker")).toBeTruthy();
    expect(within(pick).getByTestId("focus-marker")).toBeTruthy();
    expect(within(pick).getByText(/Tocá/)).toBeTruthy();
    expect(within(see).getByText(/como lo ven tus clientes/)).toBeTruthy();
    expect(
      within(see).getByRole("button", { name: "Escritorio" }),
    ).toBeTruthy();
    expect(within(see).getByRole("button", { name: "Móvil" })).toBeTruthy();
    expect(see.querySelector("img[data-cover-img]")).toBeTruthy();
    expect(pick.querySelector("img[data-cover-img]")).toBeNull();
  });

  it("per-device controls: switching to Móvil without a mobile cover explains the fallback and offers to choose one", async () => {
    show("/admin/g/g1?tab=portada");
    const pick = screen.getByRole("region", {
      name: "1. Elegí el punto focal",
    });
    await userEvent.click(
      within(pick).getByRole("button", { name: "Portada móvil" }),
    );
    expect(within(pick).getByText(/se usa la de escritorio/)).toBeTruthy();
    // The preview follows the same device.
    const see = screen.getByRole("region", { name: "2. Así se ve" });
    expect(
      within(see)
        .getByRole("button", { name: "Móvil" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // Choosing a mobile photo posts intent=cover device=mobile.
    const choose = within(pick).getByRole("button", { name: "Usar IMG_1" });
    const form = choose.closest("form")!;
    expect(
      (form.querySelector("input[name=intent]") as HTMLInputElement).value,
    ).toBe("cover");
    expect(
      (form.querySelector("input[name=device]") as HTMLInputElement).value,
    ).toBe("mobile");
    expect(
      (form.querySelector("input[name=photoId]") as HTMLInputElement).value,
    ).toBe("p1");
  });

  it("with a mobile cover: the picker edits the mobile focus and the mobile preview shows that photo", async () => {
    show("/admin/g/g1?tab=portada", {
      coverPhotoIdMobile: "p3",
      coverFocusMobile: { x: 10, y: 20 },
    });
    const pick = screen.getByRole("region", {
      name: "1. Elegí el punto focal",
    });
    const see = screen.getByRole("region", { name: "2. Así se ve" });
    await userEvent.click(within(see).getByRole("button", { name: "Móvil" }));
    expect(
      within(pick)
        .getByRole("button", { name: "Portada móvil" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const save = within(pick)
      .getByRole("button", { name: "Guardar punto focal" })
      .closest("form")!;
    expect(
      (save.querySelector("input[name=device]") as HTMLInputElement).value,
    ).toBe("mobile");
    expect(
      (save.querySelector("input[name=focusX]") as HTMLInputElement).value,
    ).toBe("10");
    expect(
      (
        pick.querySelector(
          "[data-testid=focus-picker] img:not([data-placeholder])",
        ) as HTMLImageElement
      ).getAttribute("src"),
    ).toBe("/admin/img/p3/view-sm");
    expect(
      (
        see.querySelector("img[data-cover-img]") as HTMLImageElement
      ).getAttribute("src"),
    ).toBe("/admin/img/p3/view-sm");
    // Back to desktop: the desktop photo and its own focus form.
    await userEvent.click(
      within(see).getByRole("button", { name: "Escritorio" }),
    );
    expect(
      (
        see.querySelector("img[data-cover-img]") as HTMLImageElement
      ).getAttribute("src"),
    ).toBe("/admin/img/p2/view-sm");
    expect(
      (save.querySelector("input[name=device]") as HTMLInputElement).value,
    ).toBe("desktop");
    // "Usar la de escritorio" clears the mobile cover.
    await userEvent.click(
      within(pick).getByRole("button", { name: "Portada móvil" }),
    );
    const clear = within(pick)
      .getByRole("button", { name: "Usar la de escritorio" })
      .closest("form")!;
    expect(
      (clear.querySelector("input[name=photoId]") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (clear.querySelector("input[name=device]") as HTMLInputElement).value,
    ).toBe("mobile");
  });

  it("Prueba previews use the watermarked admin variant for both devices", async () => {
    show("/admin/g/g1?tab=portada", {
      mode: "proofing",
      coverPhotoIdMobile: "p3",
    });
    const see = screen.getByRole("region", { name: "2. Así se ve" });
    expect(see.querySelector("img[data-cover-img]")!.getAttribute("src")).toBe(
      "/admin/img/p2/view-sm-wm",
    );
    await userEvent.click(within(see).getByRole("button", { name: "Móvil" }));
    expect(see.querySelector("img[data-cover-img]")!.getAttribute("src")).toBe(
      "/admin/img/p3/view-sm-wm",
    );
  });
});

describe("Diseño: live preview of the whole gallery before saving", () => {
  const live = () => screen.getByTestId("live-preview");
  const page = () => live().querySelector("[data-preview-page]") as HTMLElement;

  it("renders the real cover and a real grid of the gallery photos (admin thumbs)", () => {
    show("/admin/g/g1?tab=diseno");
    expect(page().querySelector("[data-cover-layout]")).toBeTruthy();
    const thumbs = page().querySelectorAll(
      'img:not([data-placeholder])[src^="/admin/img/"][src$="/thumb"]',
    );
    expect(thumbs.length).toBe(4);
  });

  it("reacts instantly to palette, cover layout, grid style and spacing", async () => {
    show("/admin/g/g1?tab=diseno");
    expect(page().getAttribute("data-theme")).toBe("claro");
    await userEvent.click(screen.getByLabelText("Oscuro"));
    expect(page().getAttribute("data-theme")).toBe("oscuro");
    await userEvent.click(screen.getByLabelText("Centrada"));
    expect(page().querySelector('[data-cover-layout="centrada"]')).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Cuadrícula"));
    expect(page().getAttribute("data-grid-style")).toBe("cuadricula");
    await userEvent.click(screen.getByLabelText("Amplio"));
    expect(page().getAttribute("data-grid-gap")).toBe("amplio");
  });

  it("shows 'sin guardar' with Guardar / Descartar, and Descartar restores the saved design", async () => {
    show("/admin/g/g1?tab=diseno");
    expect(screen.queryByText(/sin guardar/i)).toBeNull();
    await userEvent.click(screen.getByLabelText("Arena"));
    expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
    const save = screen.getByRole("button", {
      name: "Guardar diseño",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(save.getAttribute("form")).toBe(
      (document.querySelector("form[data-design-form]") as HTMLFormElement).id,
    );
    await userEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(page().getAttribute("data-theme")).toBe("claro");
    expect(screen.queryByText("Cambios sin guardar")).toBeNull();
    expect((screen.getByLabelText("Claro") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("the Diseño tab label marks unsaved changes", async () => {
    show("/admin/g/g1?tab=diseno");
    await userEvent.click(screen.getByLabelText("Gris"));
    const nav = screen.getByRole("navigation", {
      name: "Secciones de la galería",
    });
    expect(
      within(nav)
        .getByRole("link", { name: /Diseño/ })
        .querySelector("[data-unsaved]"),
    ).toBeTruthy();
  });

  it("Escritorio/Móvil renders the preview at a phone or desktop width inside a frame", async () => {
    show("/admin/g/g1?tab=diseno");
    const frame = () => live().querySelector("[data-frame]") as HTMLElement;
    const viewport = () =>
      live().querySelector("[data-viewport]") as HTMLElement;
    expect(frame().getAttribute("data-frame")).toBe("desktop");
    expect(viewport().style.width).toBe("1280px");
    await userEvent.click(
      within(live()).getByRole("button", { name: "Móvil" }),
    );
    expect(frame().getAttribute("data-frame")).toBe("mobile");
    expect(viewport().style.width).toBe("390px");
  });

  it("the preview is inert (no tab stops or clicks inside the fake page)", () => {
    show("/admin/g/g1?tab=diseno");
    expect(page().closest("[inert]")).toBeTruthy();
  });
});

describe("CoverHero: per-device cover", () => {
  it("public page: a <picture> with a narrow-viewport source for the mobile cover", () => {
    inRouter(
      <CoverHero
        title="T"
        date={null}
        studio="S"
        src="/img/a/view-lg?v=1"
        proofing={false}
        focus={null}
        scrollLabel="Ver"
        mobile={{
          src: "/img/b/view-lg?v=2",
          focus: { x: 1, y: 2 },
          aspect: 0.66,
        }}
      />,
    );
    const source = document.querySelector(
      "picture source",
    ) as HTMLSourceElement;
    expect(source.getAttribute("media")).toBe("(max-width: 767px)");
    expect(source.getAttribute("srcset")).toBe("/img/b/view-lg?v=2");
    expect(document.querySelector("picture img")!.getAttribute("src")).toBe(
      "/img/a/view-lg?v=1",
    );
  });

  it("no mobile cover: a plain img (unchanged)", () => {
    inRouter(
      <CoverHero
        title="T"
        date={null}
        studio="S"
        src="/img/a/view-lg"
        proofing={false}
        focus={null}
        scrollLabel="Ver"
      />,
    );
    expect(document.querySelector("picture")).toBeNull();
    expect(document.querySelector("img[data-cover-img]")).toBeTruthy();
  });

  it("uses the mobile focal point when the viewport is narrow", () => {
    const listeners: (() => void)[] = [];
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) =>
        ({
          matches: q === "(max-width: 767px)",
          media: q,
          addEventListener: (_: string, f: () => void) => listeners.push(f),
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    inRouter(
      <CoverHero
        title="T"
        date={null}
        studio="S"
        src="/img/a/view-lg"
        proofing={false}
        focus={null}
        scrollLabel="Ver"
        mobile={{ src: "/img/b/view-lg", focus: { x: 1, y: 2 }, aspect: 0.66 }}
      />,
    );
    expect(
      document
        .querySelector("img[data-cover-img]")!
        .getAttribute("data-cover-device"),
    ).toBe("mobile");
  });
});

describe("admin preview page", () => {
  it("renders the real gallery with admin image URLs, a preview bar and no API calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const Stub = createRoutesStub([
      {
        path: "/admin/g/g1/preview",
        Component: () => (
          <AdminGalleryPreview
            data={{
              id: "g1",
              status: "draft",
              hasPin: true,
              expired: false,
              gallery: {
                slug: "boda-ana",
                requireEmail: true,
                title: "Boda Ana",
                eventDate: null,
                coverPhotoId: "p1",
                coverPhotoIdMobile: "p2",
                coverFocusMobile: null,
                mode: "proofing",
                allowBulk: false,
                allowHighres: false,
                allowWeb: false,
                allowIg: false,
                palette: "arena",
                coverLayout: "completa",
                gridStyle: "cuadricula",
                gridGap: "normal",
                sets: [{ name: "Highlights", count: 2 }],
              },
              photos: [
                {
                  id: "p1",
                  width: 300,
                  height: 200,
                  set: "Highlights",
                  variants: { web: true, ig: true },
                  v: "aaaa",
                },
                {
                  id: "p2",
                  width: 200,
                  height: 300,
                  set: "Highlights",
                  variants: { web: true, ig: true },
                  v: "bbbb",
                },
              ],
            }}
          />
        ),
      },
    ]);
    render(<Stub initialEntries={["/admin/g/g1/preview"]} />);
    await act(async () => {});
    expect(screen.getByText(/Vista previa/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Volver al editor" })
        .getAttribute("href"),
    ).toBe("/admin/g/g1?device=desktop");
    const srcs = [...document.querySelectorAll("img")].map((i) =>
      i.getAttribute("src"),
    );
    expect(srcs).toContain("/admin/img/p1/thumb-wm");
    expect(srcs).toContain("/admin/img/p1/view-sm-wm");
    expect(srcs.every((s) => !s?.startsWith("/img/"))).toBe(true);
    expect(
      document.querySelector("picture source")!.getAttribute("srcset"),
    ).toBe("/admin/img/p2/view-sm-wm");
    // Favourites toggle in memory only.
    const heart = screen.getAllByRole("button", {
      name: "Agregar a favoritas",
    })[0]!;
    await userEvent.click(heart);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
