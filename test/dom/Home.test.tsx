import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { HomePage } from "../../app/components/HomePage";
import type { HomeItem } from "../../app/lib/server/home";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";

const item = (over: Partial<HomeItem> = {}): HomeItem => ({
  slug: "boda-ana",
  title: "Boda Ana",
  eventDate: "2026-03-14",
  cover: { id: "p1", v: "abcdef0123456789", focus: null, aspect: 1.5 },
  ...over,
});

function stub(items: HomeItem[], lang: "en" | "es" = "es") {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang,
        messages: lang === "en" ? en : es,
        studioName: "Estudio Test",
      }),
      Component: () => <HomePage items={items} />,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("HomePage", () => {
  it("renders the studio heading and a linked cover per gallery", async () => {
    stub([item(), item({ slug: "otra", title: "Otra", eventDate: null })]);
    expect(
      await screen.findByRole("heading", { level: 1, name: /Estudio Test/ }),
    ).toBeTruthy();
    const link = (await screen.findByRole("link", {
      name: /Boda Ana/,
    })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/boda-ana");
    const img = link.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/img/p1/view-sm?v=abcdef0123456789");
    expect(img.getAttribute("alt")).toBe("Boda Ana");
    expect(link.textContent).toContain("2026");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
  it("encodes slugs in links", async () => {
    stub([item({ slug: "a b" })]);
    const link = (await screen.findByRole("link", {
      name: /Boda Ana/,
    })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/a%20b");
  });
  it("keeps the privacy link and the ES/EN toggle", async () => {
    stub([item()], "en");
    expect(
      (await screen.findByRole("link", { name: "Privacy" })).getAttribute(
        "href",
      ),
    ).toBe("/privacy");
    expect(document.querySelector("nav[aria-label]")?.textContent).toContain(
      "ES",
    );
  });
  it("English date formatting", async () => {
    stub([item()], "en");
    await screen.findByRole("link", { name: /Boda Ana/ });
    expect(document.body.textContent).toContain("March 14, 2026");
  });
  it("empty state is the minimal home: logo and privacy link, no grid", async () => {
    stub([]);
    await screen.findByRole("heading", { level: 1 });
    expect(document.querySelector("ul")).toBeNull();
    expect(screen.getByRole("link", { name: "Privacidad" })).toBeTruthy();
    expect(document.querySelector("[data-logo=wordmark]")).not.toBeNull();
  });
});
