import { render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoverHero } from "../../app/components/CoverHero";
import { GalleryView } from "../../app/components/GalleryView";
import type { OpenGallery } from "../../app/components/types";
import { en } from "../../app/i18n/en";
import { photos } from "./fixtures";

const gallery = (over: Partial<OpenGallery> = {}): OpenGallery => ({
  slug: "boda",
  requireEmail: false,
  title: "Boda",
  eventDate: null,
  coverPhotoId: "p0",
  coverFocus: null,
  allowBulk: true,
  allowHighres: true,
  allowWeb: true,
  allowIg: true,
  mode: "delivery",
  palette: "claro",
  coverLayout: "completa",
  gridStyle: "filas",
  gridGap: "normal",
  sets: [{ name: "A", count: 3 }],
  ...over,
});

function stub(node: React.ReactNode) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "en", messages: en, studioName: "381 Studios" }),
      Component: () => <>{node}</>,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("public cover uses the focal point", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ visitor: null, favorites: [] })),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("object-position is computed from the image point, aspect and measured frame", async () => {
    const w = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(1000);
    const h = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(500);
    stub(
      <GalleryView
        gallery={gallery({ coverFocus: { x: 20, y: 60 } })}
        photos={photos(3)}
      />,
    );
    await screen.findByTestId("tile-0");
    const img = document.querySelector(
      "header img[data-cover-img]",
    ) as HTMLImageElement;
    // p0 is 3000x2000 -> scaled 1000x667 in 1000x500: x uncropped (50), y cropped
    const y = ((0.6 * (1000 / 1.5) - 250) / (1000 / 1.5 - 500)) * 100;
    expect(img.style.objectPosition).toBe(`50% ${y}%`);
    w.mockRestore();
    h.mockRestore();
  });
  it("centered when there is no focus", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos(3)} />);
    await screen.findByTestId("tile-0");
    const img = document.querySelector(
      "header img[data-cover-img]",
    ) as HTMLImageElement;
    expect(img.style.objectPosition).toBe("50% 50%");
  });
});

describe("CoverHero", () => {
  const props = {
    title: "Boda",
    date: "1 November 2026",
    studio: "381 Studios",
    src: "/img/p0/view-lg",
    proofing: false,
    focus: null,
    scrollLabel: "View gallery",
  };
  const hero = (extra: Record<string, unknown> = {}) =>
    stub(<CoverHero {...props} {...extra} />);
  it("renders the shared markup (title, date, studio, scroll button)", async () => {
    hero({ onScroll: () => {} });
    expect(await screen.findByRole("heading", { name: "Boda" })).toBeTruthy();
    expect(screen.getByText("1 November 2026")).toBeTruthy();
    expect(
      document.querySelector("header [data-logo=wordmark]")?.textContent,
    ).toBe("381 Studios");
    expect(screen.getByRole("button", { name: "View gallery" })).toBeTruthy();
  });
  it("proofing adds the shield and protection class", async () => {
    hero({ proofing: true });
    expect(await screen.findByTestId("cover-shield")).toBeTruthy();
    expect(document.querySelector(".img-protect")).toBeTruthy();
  });
  it("embedded (preview) mode: fills its box, no real button, not a landmark heading level 1", async () => {
    hero({ embedded: true });
    await waitFor(() =>
      expect(document.querySelector("[data-logo=wordmark]")).not.toBeNull(),
    );
    expect(
      document.querySelector("header [data-logo=wordmark]")?.textContent,
    ).toBe("381 Studios");
    expect(screen.queryByRole("button", { name: "View gallery" })).toBeNull();
    expect(document.querySelector("header")!.className).not.toMatch(/h-dvh/);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
  it("no src: no image", async () => {
    hero({ src: null });
    await waitFor(() =>
      expect(document.querySelector("[data-logo=wordmark]")).not.toBeNull(),
    );
    expect(document.querySelector("img[data-cover-img]")).toBeNull();
  });
});
