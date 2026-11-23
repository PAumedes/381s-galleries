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

function stub(lang: "en" | "es" = "es") {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang,
        messages: lang === "en" ? en : es,
        studioName: "Estudio Test",
      }),
      Component: () => <ClientPage page={page} />,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

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
