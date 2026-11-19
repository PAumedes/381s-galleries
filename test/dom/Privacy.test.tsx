import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { PrivacyPage } from "../../app/components/PrivacyPage";
import { SiteFooter } from "../../app/components/SiteFooter";

function stub(node: ReactNode, lang: "en" | "es" = "es") {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang,
        messages: lang === "en" ? en : es,
        studioName: "Estudio Test",
      }),
      Component: () => <>{node}</>,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("PrivacyPage", () => {
  it("renders in Spanish with the studio name and a generic contact line", async () => {
    stub(<PrivacyPage />, "es");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Privacidad" }),
    ).toBeTruthy();
    expect(document.body.textContent).toContain("Estudio Test");
    expect(document.body.textContent).toContain(
      "contactá al estudio por los medios habituales",
    );
    expect(document.body.textContent).toContain("Google Drive");
    expect(document.querySelector("img")).toBeTruthy();
  });
  it("renders in English", async () => {
    stub(<PrivacyPage />, "en");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Privacy" }),
    ).toBeTruthy();
    expect(document.body.textContent).toContain("read-only");
    expect(document.body.textContent).not.toContain("contactá");
  });
  it("shows the configured contact email", async () => {
    stub(<PrivacyPage contactEmail="hola@example.com" />, "en");
    const a = await screen.findByRole("link", { name: "hola@example.com" });
    expect(a.getAttribute("href")).toBe("mailto:hola@example.com");
  });
});

describe("SiteFooter", () => {
  it("links to /privacy", async () => {
    stub(<SiteFooter />, "es");
    const a = await screen.findByRole("link", { name: "Privacidad" });
    expect(a.getAttribute("href")).toBe("/privacy");
  });

  it.each([
    [
      "es",
      [
        "Nunca guardamos tu dirección IP",
        "una sola vía",
        "contar visitas únicas",
        "detectar abusos",
        "no se elimina automáticamente",
        "pedíselo al estudio",
        "ciudad",
        "dominio, sin ruta ni parámetros",
        "User-Agent",
      ],
    ],
    [
      "en",
      [
        "We never store your IP address",
        "one-way hash",
        "count unique visits",
        "detect abuse",
        "nothing is deleted automatically",
        "ask the studio",
        "city",
        "domain only, no path or parameters",
        "User-Agent",
      ],
    ],
  ] as const)(
    "discloses exactly what is collected, the IP hash and retention (%s)",
    async (lang, phrases) => {
      stub(<PrivacyPage />, lang);
      await screen.findByRole("heading", { level: 1 });
      for (const p of phrases) expect(document.body.textContent).toContain(p);
    },
  );
});
