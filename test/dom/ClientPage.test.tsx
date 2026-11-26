import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { ClientPage } from "../../app/components/ClientPage";
import { clientPageMeta } from "../../app/lib/og";
import type { ClientPageData } from "../../app/lib/server/client-page";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";

const page: ClientPageData = {
  state: "client",
  clientName: "ACME Corp",
  clientSlug: "acme",
  page: 1,
  pageCount: 1,
  items: [
    {
      slug: "boda",
      clientSlug: "acme",
      title: "Boda Ana",
      eventDate: "2026-03-14",
      cover: { id: "p1", v: "abcdef0123456789", focus: null, aspect: 1.5 },
    },
    {
      slug: "privado",
      clientSlug: "acme",
      title: "Privado",
      eventDate: null,
      cover: null,
      locked: true,
    },
  ],
};

function stub(lang: "en" | "es" = "es", p: ClientPageData = page) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang,
        messages: lang === "en" ? en : es,
        studioName: "Estudio Test",
      }),
      Component: () => <ClientPage page={p} />,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

const tiffPage: ClientPageData = {
  ...page,
  items: [
    {
      slug: "final",
      clientSlug: "acme",
      title: "Entrega final",
      eventDate: "2026-03-14",
      cover: null,
      tiffOnly: true,
    },
  ],
};

describe("T6.53d2 TIFF delivery tile", () => {
  it("shows the title, the date and the caption, no image and no lock, linking into the album", async () => {
    stub("es", tiffPage);
    const link = await screen.findByRole("link", { name: /Entrega final/ });
    expect(link.getAttribute("href")).toBe("/acme/final");
    expect(link.querySelector("img")).toBeNull();
    expect(link.querySelector("svg")).toBeNull();
    expect(link.textContent).toContain("Entrega en TIFF");
    expect(link.textContent).toContain("Entrega final");
    expect(link.textContent?.toLowerCase()).toContain("marzo");
  });

  it("is translated to English", async () => {
    stub("en", tiffPage);
    const link = await screen.findByRole("link", { name: /Entrega final/ });
    expect(link.textContent).toContain("TIFF delivery");
  });
});

describe("T6.40e ClientPage", () => {
  it("shows the client name and links every album under /<client>/<album>", async () => {
    stub();
    expect(
      await screen.findByRole("heading", { level: 1, name: "ACME Corp" }),
    ).toBeTruthy();
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/acme/boda");
    expect(hrefs).toContain("/acme/privado");
  });

  it("a PIN album has a lock (labelled) and no image", async () => {
    stub();
    const link = await screen.findByRole("link", { name: /Privado/ });
    expect(link.querySelector("img")).toBeNull();
    expect(link.querySelector("svg title")?.textContent).toBe("Con PIN");
    const open = screen.getByRole("link", { name: /Boda Ana/ });
    expect(open.querySelector("img")?.getAttribute("src")).toBe(
      "/img/p1/view-sm?v=abcdef0123456789",
    );
  });

  it("is translated to English", async () => {
    stub("en");
    const link = await screen.findByRole("link", { name: /Privado/ });
    expect(link.querySelector("svg title")?.textContent).toBe("PIN protected");
    expect(screen.getByRole("list", { name: "Albums" })).toBeTruthy();
  });

  describe("T6.49 pager", () => {
    const at = (n: number, count = 3): ClientPageData => ({
      ...page,
      page: n,
      pageCount: count,
    });
    const nav = (name: string) => screen.findByRole("navigation", { name });

    it("no pager for a single page", async () => {
      stub();
      await screen.findByRole("heading", { level: 1 });
      expect(screen.queryByRole("navigation", { name: "Páginas" })).toBeNull();
    });

    it("first page: only Siguiente, to ?pagina=2, with Página 1 de 3", async () => {
      stub("es", at(1));
      const n = await nav("Páginas");
      expect(n.textContent).toContain("Página 1 de 3");
      expect(screen.queryByRole("link", { name: "Anterior" })).toBeNull();
      expect(
        screen.getByRole("link", { name: "Siguiente" }).getAttribute("href"),
      ).toBe("/acme?pagina=2");
    });

    it("middle page links both ways; page 2 back goes to the bare URL", async () => {
      stub("es", at(2));
      await nav("Páginas");
      expect(
        screen.getByRole("link", { name: "Anterior" }).getAttribute("href"),
      ).toBe("/acme");
      expect(
        screen.getByRole("link", { name: "Siguiente" }).getAttribute("href"),
      ).toBe("/acme?pagina=3");
    });

    it("last page: only Anterior, to the previous page; English text", async () => {
      stub("en", at(3));
      const n = await nav("Pages");
      expect(n.textContent).toContain("Page 3 of 3");
      expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
      expect(
        screen.getByRole("link", { name: "Previous" }).getAttribute("href"),
      ).toBe("/acme?pagina=2");
    });

    it("pager links are 48px tap targets and use logical classes only", async () => {
      stub("es", at(2));
      const n = await nav("Páginas");
      for (const a of n.querySelectorAll("a")) {
        expect(a.className).toContain("min-h-12");
        expect(a.className).not.toMatch(
          /\b(ml|mr|pl|pr|left|right|text-left|text-right)-/,
        );
      }
    });
  });

  it("meta is noindex and carries no cover image", () => {
    const m = clientPageMeta(page, {
      studio: "Estudio",
      origin: "https://x.ar",
    });
    expect(m).toContainEqual({ name: "robots", content: "noindex,nofollow" });
    expect(m).toContainEqual({ title: "ACME Corp · Estudio" });
    expect(m.some((t) => t.property === "og:image")).toBe(false);
    expect(m).toContainEqual({
      property: "og:url",
      content: "https://x.ar/acme",
    });
  });
});
