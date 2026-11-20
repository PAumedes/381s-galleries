import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { EditorHeader } from "../../app/components/admin/gallery-edit/EditorHeader";
import type { EditGallery } from "../../app/components/admin/gallery-edit/types";
import {
  GalleryList,
  type GalleryListItem,
} from "../../app/components/admin/GalleryList";
import { es } from "../../app/i18n/es";
import { en } from "../../app/i18n/en";

const item = (over: Partial<GalleryListItem> = {}): GalleryListItem => ({
  id: "g1",
  title: "Boda Ana",
  slug: "boda-ana",
  clientName: "Ana",
  eventDate: "2026-11-01",
  status: "published",
  expiresAt: null,
  expired: false,
  coverPhotoId: "p1",
  photoCount: 120,
  views: 33,
  downloads: 7,
  issueCount: 0,
  deleting: false,
  ...over,
});

function showList(galleries: GalleryListItem[]) {
  const Stub = createRoutesStub([
    {
      path: "/admin",
      Component: () => (
        <GalleryList galleries={galleries} filter="todas" total={1} />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin"]} />);
}

const has = (el: Element, cls: string) =>
  el.className.split(/\s+/).includes(cls);

describe("T6.36 admin filter chips on phones", () => {
  it("is one nowrap row that scrolls sideways as a fallback; chips never shrink and keep a 44px tap height", async () => {
    showList([item()]);
    const nav = await screen.findByRole("navigation");
    expect(has(nav, "flex-nowrap")).toBe(true);
    expect(has(nav, "flex-wrap")).toBe(false);
    expect(has(nav, "overflow-x-auto")).toBe(true);
    const chips = within(nav).getAllByRole("link");
    expect(chips).toHaveLength(4);
    for (const c of chips) {
      expect(has(c, "shrink-0")).toBe(true);
      expect(has(c, "whitespace-nowrap")).toBe(true);
      expect(has(c, "min-h-tap")).toBe(true);
    }
  });
});

describe("T6.36 admin gallery list rows on phones", () => {
  async function row(over: Partial<GalleryListItem> = {}) {
    showList([item(over)]);
    const link = await screen.findByRole("link", { name: "Boda Ana" });
    return { link, tr: link.closest("tr")! };
  }
  it("title is the primary line: 16px bold, up to two lines", async () => {
    const { link } = await row();
    for (const c of [
      "max-xl:text-base",
      "max-xl:font-bold",
      "max-xl:line-clamp-2",
    ])
      expect(has(link, c), c).toBe(true);
  });
  it("the whole row is the tap target (stretched link) and rows are spaced", async () => {
    const { link, tr } = await row();
    expect(has(link, "max-xl:after:absolute")).toBe(true);
    expect(has(link, "max-xl:after:inset-0")).toBe(true);
    expect(has(tr, "max-xl:relative")).toBe(true);
    expect(has(tr, "max-xl:py-4")).toBe(true);
  });
  it("rarely used details are hidden below xl: slug, views, downloads, expiry", async () => {
    const { tr } = await row({ expiresAt: "2027-01-01T12:00:00.000Z" });
    for (const text of ["/boda-ana", "33", "7"]) {
      const el = within(tr).getByText(text);
      const cell = el.closest("td")!;
      expect(has(el, "max-xl:hidden") || has(cell, "max-xl:hidden"), text).toBe(
        true,
      );
    }
    const exp = within(tr)
      .getAllByRole("cell")
      .find((c) => c.dataset.label === "Vence")!;
    expect(has(exp, "max-xl:hidden")).toBe(true);
  });
  it("date and photo count are ONE muted line of real text, at least 14px", async () => {
    const { tr } = await row({ photoCount: 120 });
    const line = within(tr)
      .getByText(/·\s*120 fotos/)
      .closest("td")!;
    expect(line.textContent).toMatch(/2026.*·\s*120 fotos$/);
    expect(has(line, "max-xl:text-sm")).toBe(true);
    expect(has(line, "max-xl:text-grey-600")).toBe(true);
    const photos = within(tr)
      .getAllByRole("cell")
      .find((c) => c.dataset.label === "Fotos")!;
    expect(has(photos, "max-xl:hidden")).toBe(true);
    expect(photos.className).not.toContain("after:");
  });
  it("the photo count is plural-aware: 1 foto, 2 fotos", async () => {
    const one = await row({ photoCount: 1 });
    expect(one.tr.textContent).toContain("· 1 foto");
    expect(one.tr.textContent).not.toContain("1 fotos");
  });
  it("every phone cell has an explicit grid column and row", async () => {
    const { tr } = await row({ issueCount: 2 });
    for (const td of within(tr).getAllByRole("cell")) {
      if (has(td, "max-xl:hidden") || td.className.includes("empty:hidden"))
        continue;
      expect(td.className, td.textContent!).toMatch(/max-xl:col-start-\d/);
      expect(td.className, td.textContent!).toMatch(/max-xl:row-start-\d/);
    }
  });
  it("one clear status badge; a published proof gallery reads Prueba", async () => {
    const { tr } = await row({ mode: "proofing" });
    expect(within(tr).getByText("Prueba")).toBeTruthy();
    expect(within(tr).queryByText("Publicada")).toBeNull();
  });
  it("a delivery gallery keeps its status; draft proofing stays Borrador", async () => {
    const a = await row({ mode: "delivery" });
    expect(within(a.tr).getByText("Publicada")).toBeTruthy();
  });
  it("draft proofing stays Borrador", async () => {
    const { tr } = await row({ mode: "proofing", status: "draft" });
    expect(within(tr).getByText("Borrador")).toBeTruthy();
  });
  it("the continue-deleting link stays above the stretched row link", async () => {
    const { tr } = await row({ deleting: true });
    const l = within(tr).getByText("Continuar eliminación");
    expect(has(l, "relative")).toBe(true);
    expect(has(l, "z-10")).toBe(true);
  });
});

describe("T6.36 album header on phones", () => {
  const g = { id: "g1", title: "Boda Ana", status: "published" } as EditGallery;
  function header() {
    const Stub = createRoutesStub([
      { path: "/admin/g/:id", Component: () => <EditorHeader g={g} /> },
    ]);
    return render(<Stub initialEntries={["/admin/g/g1"]} />);
  }
  it("a live proof gallery reads Prueba in the header pill too", async () => {
    g.mode = "proofing";
    try {
      header();
      expect(await screen.findByText("Prueba")).toBeTruthy();
      expect(screen.queryByText("Publicada")).toBeNull();
    } finally {
      g.mode = "delivery";
    }
  });
  it("the back link takes its own row", async () => {
    header();
    const back = await screen.findByRole("link", { name: /Galerías/ });
    expect(has(back, "basis-full")).toBe(true);
    expect(has(back, "md:basis-auto")).toBe(true);
  });
  it("status and Vista previa share a 2-column grid with equal height >= 48px", async () => {
    header();
    const prev = await screen.findByRole("link", { name: /Vista previa/ });
    const status = screen.getByText("Publicada");
    const grid = prev.parentElement!;
    expect(status.parentElement).toBe(grid);
    expect(has(grid, "grid")).toBe(true);
    expect(has(grid, "grid-cols-2")).toBe(true);
    for (const el of [prev, status]) {
      expect(has(el, "min-h-12"), el.textContent!).toBe(true);
      expect(has(el, "text-micro")).toBe(true);
      expect(has(el, "uppercase")).toBe(true);
      expect(has(el, "justify-center")).toBe(true);
    }
  });
});

describe("T6.36 slug label", () => {
  const SLUG_KEYS = Object.keys(es).filter((k) => /slug/i.test(k));
  it("Spanish never shows the word slug to the user", () => {
    const bad = Object.entries(es)
      .filter(([, v]) => /slug/i.test(String(v).replace(/\{slug\}/g, "")))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });
  it("Spanish names the field Dirección web, with a hint on what it is", () => {
    expect(es["admin.edit.field.slug"]).toBe("Dirección web");
    expect(es["admin.edit.hint.slug"]).toMatch(/enlace/);
  });
  it("English keeps Slug and every slug key exists in both languages", () => {
    expect(en["admin.edit.field.slug"]).toBe("Slug");
    for (const k of SLUG_KEYS) expect(k in en, k).toBe(true);
  });
});
