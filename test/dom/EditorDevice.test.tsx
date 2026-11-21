import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminGalleryPreview } from "../../app/components/admin/AdminGalleryPreview";
import {
  GalleryEditView,
  type GalleryEditData,
} from "../../app/components/admin/GalleryEditView";
import { editorHref, previewHref } from "../../app/lib/preview-device";

const data: GalleryEditData = {
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
    { id: "p1", set: "A", name: "IMG_1", takenAt: null },
    { id: "p2", set: "A", name: "IMG_2", takenAt: null },
  ],
  version: "v1",
  issues: { groups: [], truncated: 0, total: 0 },
};

function phone(on: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: on && q.includes("max-width: 767px"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

let revalidations = 0;
function editor(url: string) {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      loader: () => ++revalidations,
      action: () => ({ ok: true, intent: "focus", message: "ok" }),
      Component: () => <GalleryEditView data={data} actionData={undefined} />,
    },
  ]);
  return render(<Stub initialEntries={[url]} />);
}
const mobileBtn = () => screen.findByRole("button", { name: "Portada móvil" });
const pressed = async (name: string) =>
  (await screen.findByRole("button", { name })).getAttribute("aria-pressed");

beforeEach(() => {
  sessionStorage.clear();
  phone(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("T6.35 editor device (desktop / mobile) sticks", () => {
  it("defaults to mobile on a phone-sized viewport", async () => {
    phone(true);
    editor("/admin/g/g1?tab=portada");
    expect(await pressed("Portada móvil")).toBe("true");
    expect(await pressed("Portada de escritorio")).toBe("false");
  });

  it("defaults to desktop on a wide viewport", async () => {
    editor("/admin/g/g1?tab=portada");
    expect(await pressed("Portada de escritorio")).toBe("true");
  });

  it("?device= wins over the viewport default", async () => {
    editor("/admin/g/g1?tab=portada&device=mobile");
    expect(await pressed("Portada móvil")).toBe("true");
    cleanup();
    phone(true);
    editor("/admin/g/g1?tab=portada&device=desktop");
    expect(await pressed("Portada de escritorio")).toBe("true");
  });

  it("an explicit choice survives a reload (sessionStorage)", async () => {
    editor("/admin/g/g1?tab=portada");
    fireEvent.click(await mobileBtn());
    cleanup();
    editor("/admin/g/g1?tab=portada");
    expect(await pressed("Portada móvil")).toBe("true");
  });

  it("an explicit desktop choice on a phone survives a reload", async () => {
    phone(true);
    editor("/admin/g/g1?tab=portada");
    fireEvent.click(
      await screen.findByRole("button", { name: "Portada de escritorio" }),
    );
    cleanup();
    editor("/admin/g/g1?tab=portada");
    expect(await pressed("Portada de escritorio")).toBe("true");
  });

  it("survives a save and the revalidation that follows", async () => {
    editor("/admin/g/g1?tab=portada");
    fireEvent.click(await mobileBtn());
    const before = revalidations;
    fireEvent.click(
      screen.getByRole("button", { name: "Guardar punto focal" }),
    );
    await vi.waitFor(() => expect(revalidations).toBeGreaterThan(before));
    expect(await pressed("Portada móvil")).toBe("true");
  });

  it("a garbage ?device= is ignored", async () => {
    editor("/admin/g/g1?tab=portada&device=tablet");
    expect(await pressed("Portada de escritorio")).toBe("true");
  });

  it("'Vista previa' links carry the device and the tab", async () => {
    editor("/admin/g/g1?tab=portada&device=mobile");
    const a = await screen.findByRole("link", { name: /Vista previa/ });
    expect(a.getAttribute("href")).toBe(
      "/admin/g/g1/preview?device=mobile&tab=portada",
    );
  });

  it("link helpers", () => {
    expect(previewHref("a b", "mobile")).toBe(
      "/admin/g/a%20b/preview?device=mobile",
    );
    expect(previewHref("g1", "desktop", "fotos")).toBe(
      "/admin/g/g1/preview?device=desktop&tab=fotos",
    );
    expect(editorHref("g1", "mobile", "portada")).toBe(
      "/admin/g/g1?tab=portada&device=mobile",
    );
    expect(editorHref("g1", "desktop", "datos")).toBe(
      "/admin/g/g1?device=desktop",
    );
  });
});

const previewData = {
  id: "g1",
  status: "published" as const,
  hasPin: false,
  expired: false,
  gallery: {
    slug: "boda-ana",
    requireEmail: true,
    title: "Boda Ana",
    eventDate: null,
    coverPhotoId: "p1",
    coverPhotoIdMobile: null,
    coverFocusMobile: null,
    mode: "delivery" as const,
    allowBulk: false,
    allowHighres: false,
    allowWeb: false,
    allowIg: false,
    palette: "claro" as const,
    coverLayout: "completa" as const,
    gridStyle: "filas" as const,
    gridGap: "normal" as const,
    sets: [{ name: "A", count: 1 }],
  },
  photos: [
    {
      id: "p1",
      width: 300,
      height: 200,
      set: "A",
      variants: { web: true, ig: true },
      v: "aaaa",
    },
  ],
};
function previewPage(url: string) {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1/preview",
      Component: () => <AdminGalleryPreview data={previewData} />,
    },
  ]);
  return render(<Stub initialEntries={[url]} />);
}
const back = () => screen.findByRole("link", { name: "Volver al editor" });

describe("T6.35 preview bar: 'volver al editor' keeps device and tab", () => {
  it("returns to the device and tab it came from", async () => {
    previewPage("/admin/g/g1/preview?device=mobile&tab=portada");
    expect((await back()).getAttribute("href")).toBe(
      "/admin/g/g1?tab=portada&device=mobile",
    );
  });

  it("without params: the remembered device, else the viewport default", async () => {
    phone(true);
    previewPage("/admin/g/g1/preview");
    await vi.waitFor(async () =>
      expect((await back()).getAttribute("href")).toBe(
        "/admin/g/g1?device=mobile",
      ),
    );
    cleanup();
    sessionStorage.setItem("381s.previewDevice", "desktop");
    previewPage("/admin/g/g1/preview");
    await vi.waitFor(async () =>
      expect((await back()).getAttribute("href")).toBe(
        "/admin/g/g1?device=desktop",
      ),
    );
  });

  it("ignores an unknown tab", async () => {
    previewPage("/admin/g/g1/preview?device=mobile&tab=hax");
    expect((await back()).getAttribute("href")).toBe(
      "/admin/g/g1?device=mobile",
    );
  });

  it("bar text is 16px+ and the link is a 48px touch target", async () => {
    previewPage("/admin/g/g1/preview?device=mobile");
    const link = await back();
    const bar = link.closest("[data-admin-preview-bar]")!;
    expect(bar.className).toMatch(/\btext-base\b/);
    expect(bar.className).not.toMatch(/text-micro/);
    expect(link.className).toMatch(/\bmin-h-12\b/);
    expect(bar.className).toMatch(/\bflex-col\b/);
    expect(bar.className).toMatch(/\btext-center\b/);
    expect(bar.className).toMatch(/\bsm:flex-row\b/);
    expect(bar.className).not.toMatch(/\b(fixed|sticky)\b/);
  });
});

describe("T6.42 preview bar copy", () => {
  it("is short and has both languages", async () => {
    const { esAdmin } = await import("../../app/i18n/es.admin");
    const { enAdmin } = await import("../../app/i18n/en.admin");
    expect(esAdmin["admin.preview.bar"]).toBe(
      "Vista previa: lo que ve el cliente",
    );
    expect(enAdmin["admin.preview.bar"]).toBe("Preview: what a client sees");
    for (const d of [esAdmin, enAdmin]) {
      expect(d["admin.preview.bar"].length).toBeLessThanOrEqual(40);
      expect(d["admin.preview.back"].length).toBeLessThanOrEqual(20);
    }
  });
});
