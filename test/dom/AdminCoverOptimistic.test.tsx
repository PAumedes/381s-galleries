import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, useActionData, useLoaderData } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GalleryEditView,
  type GalleryEditData,
} from "../../app/components/admin/GalleryEditView";
import type { GalleryActionResult } from "../../app/lib/server/admin-galleries";

const photos = [
  { id: "p1", name: "IMG_1", v: "aaaa111111111111" },
  { id: "p2", name: "IMG_2", v: "bbbb222222222222" },
  { id: "p3", name: "IMG_3", v: "cccc333333333333" },
].map((p) => ({
  ...p,
  set: "Highlights",
  takenAt: null,
  width: 300,
  height: 200,
}));

const gallery = (over: Record<string, unknown> = {}) =>
  ({
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
    mode: "delivery",
    palette: "claro",
    coverLayout: "completa",
    gridStyle: "filas",
    gridGap: "normal",
    hasPin: false,
    coverPhotoId: "p2",
    coverFocus: null,
    coverPhotoIdMobile: null,
    coverFocusMobile: null,
    ...over,
  }) as GalleryEditData["gallery"];

type Server = { gallery: GalleryEditData["gallery"] };

/** A stub app whose action waits for `release()` and then succeeds or fails. */
function mount(
  tab: string,
  opts: {
    fail?: boolean;
    initial?: Record<string, unknown>;
    mode?: string;
    noWm?: string[];
  } = {},
) {
  const server: Server = {
    gallery: gallery({
      ...(opts.initial ?? {}),
      mode: opts.mode ?? "delivery",
    }),
  };
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const posted: FormData[] = [];
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      loader: () => ({
        gallery: server.gallery,
        hasWmFiles: true,
        hasThumbWmFiles: true,
        photos: photos.map((p) =>
          opts.noWm ? { ...p, hasWm: !opts.noWm.includes(p.id) } : p,
        ),
        version: "v1",
        issues: { groups: [], truncated: 0, total: 0 },
      }),
      action: async ({ request }) => {
        const f = await request.formData();
        posted.push(f);
        await gate;
        if (opts.fail)
          return {
            intent: "cover",
            ok: false,
            error: "No se pudo guardar la portada.",
          } satisfies GalleryActionResult;
        const id = (f.get("photoId") as string) || null;
        server.gallery =
          f.get("device") === "mobile"
            ? gallery({
                ...server.gallery,
                coverPhotoIdMobile: id,
                coverFocusMobile: null,
              })
            : gallery({ ...server.gallery, coverPhotoId: id });
        return {
          intent: "cover",
          ok: true,
          message: "Portada guardada.",
        } satisfies GalleryActionResult;
      },
      Component: () => (
        <GalleryEditView
          data={useLoaderData() as GalleryEditData}
          actionData={useActionData() as GalleryActionResult | undefined}
        />
      ),
    },
  ]);
  render(<Stub initialEntries={[`/admin/g/g1?tab=${tab}`]} />);
  return { release, posted, server };
}

const frame = (kind: "mobile" | "desktop") =>
  document.querySelector(`[data-frame="${kind}"]`) as HTMLElement | null;
const mainSrc = (kind: "mobile" | "desktop") =>
  frame(kind)?.querySelector("img[data-cover-img]")?.getAttribute("src") ?? "";
const placeholderSrc = (kind: "mobile" | "desktop") =>
  frame(kind)?.querySelector("img[data-placeholder]")?.getAttribute("src") ??
  null;

async function openMobileChooser() {
  await screen.findByTestId("cover-preview");
  await userEvent.click(screen.getByRole("button", { name: "Portada móvil" }));
}

// The editor remembers its device in sessionStorage: start every test clean.
beforeEach(() => sessionStorage.clear());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Portada: the choice shows at once (optimistic)", () => {
  it("mobile cover: the Móvil frame switches to the chosen photo before the save returns", async () => {
    const { release } = mount("portada");
    await openMobileChooser();
    // Before: no mobile cover, so the frame shows the desktop one (p2).
    expect(mainSrc("mobile")).toContain("/p2/view-sm");
    await userEvent.click(screen.getByRole("button", { name: "Usar IMG_3" }));
    // The action is still pending (the gate is closed).
    expect(mainSrc("mobile")).toContain("/p3/view-sm");
    expect(mainSrc("mobile")).not.toContain("/p2/");
    expect(screen.getByText("Foto para móvil: IMG_3")).toBeTruthy();
    // The desktop frame is untouched.
    await userEvent.click(screen.getByRole("button", { name: "Escritorio" }));
    expect(mainSrc("desktop")).toContain("/p2/view-sm");
    release();
    await userEvent.click(screen.getByRole("button", { name: "Móvil" }));
    await waitFor(() => expect(mainSrc("mobile")).toContain("/p3/view-sm"));
    // Saved: same photo, no error.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("desktop cover: the Escritorio frame switches at once", async () => {
    const { release } = mount("portada");
    await screen.findByTestId("cover-preview");
    await userEvent.click(screen.getByText("Cambiar foto"));
    await userEvent.click(screen.getByRole("button", { name: "Usar IMG_1" }));
    expect(mainSrc("desktop")).toContain("/p1/view-sm");
    release();
    await waitFor(() => expect(mainSrc("desktop")).toContain("/p1/view-sm"));
  });

  it("clearing the mobile cover shows the desktop one at once", async () => {
    const { release } = mount("portada", {
      initial: { coverPhotoIdMobile: "p3" },
    });
    await screen.findByTestId("cover-preview");
    await userEvent.click(
      screen.getByRole("button", { name: "Portada móvil" }),
    );
    expect(mainSrc("mobile")).toContain("/p3/view-sm");
    await userEvent.click(
      screen.getByRole("button", { name: "Usar la de escritorio" }),
    );
    expect(mainSrc("mobile")).toContain("/p2/view-sm");
    release();
  });

  it("the chosen photo's own focal point is reset (center) while it saves", async () => {
    const { release } = mount("portada", {
      initial: { coverPhotoIdMobile: "p1", coverFocusMobile: { x: 10, y: 90 } },
    });
    await screen.findByTestId("cover-preview");
    await userEvent.click(
      screen.getByRole("button", { name: "Portada móvil" }),
    );
    expect(
      screen.getByRole("application").getAttribute("aria-valuetext"),
    ).toContain("10%");
    await userEvent.click(screen.getByText("Cambiar foto"));
    await userEvent.click(screen.getByRole("button", { name: "Usar IMG_3" }));
    expect(
      screen.getByRole("application").getAttribute("aria-valuetext"),
    ).toContain("50%");
    release();
  });

  it("failed save: rolls back to the previous cover and shows the error", async () => {
    const { release } = mount("portada", { fail: true });
    await openMobileChooser();
    await userEvent.click(screen.getByRole("button", { name: "Usar IMG_3" }));
    expect(mainSrc("mobile")).toContain("/p3/view-sm");
    release();
    await waitFor(() => expect(mainSrc("mobile")).toContain("/p2/view-sm"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "No se pudo guardar la portada.",
    );
    expect(screen.queryByText("Foto para móvil: IMG_3")).toBeNull();
  });

  it("Fotos tab: the mobile badge moves to the chosen tile at once, and back on failure", async () => {
    const { release } = mount("fotos", { fail: true });
    await screen.findByRole("heading", { name: "Fotos" });
    const tile = (id: string) =>
      document.querySelector(`[data-photo-id="${id}"]`) as HTMLElement;
    expect(tile("p3").querySelector('[data-cover-badge="mobile"]')).toBeNull();
    await userEvent.click(
      within(tile("p3")).getByRole("button", {
        name: "Usar como portada móvil",
      }),
    );
    expect(
      tile("p3").querySelector('[data-cover-badge="mobile"]'),
    ).toBeTruthy();
    release();
    await waitFor(() =>
      expect(
        tile("p3").querySelector('[data-cover-badge="mobile"]'),
      ).toBeNull(),
    );
  });

  it("sends exactly what the buttons always sent (no extra fields)", async () => {
    const { release, posted } = mount("portada");
    await openMobileChooser();
    await userEvent.click(screen.getByRole("button", { name: "Usar IMG_3" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(Object.fromEntries(posted[0]!)).toEqual({
      intent: "cover",
      device: "mobile",
      photoId: "p3",
    });
    release();
  });
});

describe("Portada: placeholder, versioned URLs, preload", () => {
  it("shows the already-loaded thumbnail under the big image until it loads, then fades in", async () => {
    const { release } = mount("portada");
    await openMobileChooser();
    await userEvent.click(screen.getByRole("button", { name: "Usar IMG_3" }));
    const ph = placeholderSrc("mobile");
    // Same URL (with ?v=) as the chooser's thumbnail: the browser has it already.
    expect(ph).toBe("/admin/img/p3/thumb?v=cccc333333333333");
    expect(
      document
        .querySelector('button[aria-label="Usar IMG_3"] img')
        ?.getAttribute("src"),
    ).toBe(ph);
    const main = frame("mobile")!.querySelector(
      "img[data-cover-img]",
    ) as HTMLImageElement;
    expect(main.getAttribute("src")).toBe(
      "/admin/img/p3/view-sm?v=cccc333333333333",
    );
    expect(main.className).toMatch(/opacity-0/);
    fireEvent.load(main);
    await waitFor(() => expect(main.className).toMatch(/opacity-100/));
    release();
  });

  it("the placeholder sits in the same box as the image (no layout shift)", async () => {
    mount("portada");
    await openMobileChooser();
    await userEvent.click(screen.getByRole("button", { name: "Usar IMG_3" }));
    const ph = frame("mobile")!.querySelector("img[data-placeholder]")!;
    const main = frame("mobile")!.querySelector("img[data-cover-img]")!;
    expect(ph.parentElement).toBe(main.parentElement);
    expect(ph.className).toContain("absolute");
    expect(ph.className).toContain("inset-0");
    expect(ph.className).toContain("object-cover");
  });

  it("every admin image of the editor carries its ?v= (grid thumbs, chooser, previews)", async () => {
    mount("portada");
    await screen.findByTestId("cover-preview");
    const srcs = Array.from(document.querySelectorAll("img"))
      .map((i) => i.getAttribute("src") ?? "")
      .filter((s) => s.startsWith("/admin/img/"));
    expect(srcs.length).toBeGreaterThan(3);
    for (const s of srcs) expect(s, s).toMatch(/\?v=[0-9a-f]{16}$/);
  });

  it("photos without a token keep plain URLs", async () => {
    mount("fotos");
    await screen.findByRole("heading", { name: "Fotos" });
    expect(
      document.querySelector('img[src^="/admin/img/p1/thumb"]'),
    ).toBeTruthy();
  });

  it("Prueba: the placeholder is the watermarked thumb, never a clean file", async () => {
    mount("portada", { mode: "proofing" });
    await openMobileChooser();
    await userEvent.click(screen.getByRole("button", { name: "Usar IMG_3" }));
    expect(placeholderSrc("mobile")).toBe(
      "/admin/img/p3/thumb-wm?v=cccc333333333333",
    );
    expect(mainSrc("mobile")).toBe(
      "/admin/img/p3/view-sm-wm?v=cccc333333333333",
    );
  });

  it("preloads the chosen photo's cover image on selection", async () => {
    const loaded: string[] = [];
    class FakeImage {
      set src(v: string) {
        loaded.push(v);
      }
    }
    vi.stubGlobal("Image", FakeImage);
    mount("portada");
    await openMobileChooser();
    await userEvent.click(screen.getByRole("button", { name: "Usar IMG_3" }));
    await act(async () => {});
    expect(loaded).toContain("/admin/img/p3/view-sm?v=cccc333333333333");
  });
});

describe("Portada: edge cases", () => {
  it("Prueba: a mobile cover photo without preview-wm is not shown optimistically (server falls back to desktop)", async () => {
    mount("portada", { mode: "proofing", noWm: ["p3"] });
    await openMobileChooser();
    expect(mainSrc("mobile")).toContain("/p2/");
    await userEvent.click(screen.getByRole("button", { name: "Usar IMG_3" }));
    expect(mainSrc("mobile")).toContain("/p2/");
    expect(mainSrc("mobile")).not.toContain("/p3/");
  });

  it("the big image failing to load drops the placeholder and marks a failed state", async () => {
    mount("portada");
    await openMobileChooser();
    await userEvent.click(screen.getByRole("button", { name: "Usar IMG_3" }));
    const main = frame("mobile")!.querySelector(
      "img[data-cover-img]",
    ) as HTMLImageElement;
    expect(placeholderSrc("mobile")).not.toBeNull();
    fireEvent.error(main);
    await waitFor(() => expect(placeholderSrc("mobile")).toBeNull());
    expect(main.getAttribute("data-failed")).toBe("true");
  });
});
