import { readFileSync } from "node:fs";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { GalleryView } from "../../app/components/GalleryView";
import { Grid } from "../../app/components/Grid";
import { Lightbox } from "../../app/components/Lightbox";
import type { OpenGallery } from "../../app/components/types";
import { en } from "../../app/i18n/en";
import { photos, t } from "./fixtures";

/** fireEvent returns false when a handler called preventDefault. */
const ctxMenuPrevented = (el: Element) => !fireEvent.contextMenu(el);

describe("Grid image protection", () => {
  it("protect: overlay above each image, contextmenu prevented, draggable false", () => {
    render(<Grid photos={photos(3)} t={t} onOpen={() => {}} protect />);
    for (let i = 0; i < 3; i++) {
      const tile = screen.getByTestId(`tile-${i}`);
      const shield = screen.getByTestId(`shield-${i}`);
      const img = tile.querySelector("img")!;
      expect(img.getAttribute("draggable")).toBe("false");
      expect(shield.getAttribute("aria-hidden")).toBe("true");
      // Overlay comes after the img in DOM order => painted above it.
      expect(
        img.compareDocumentPosition(shield) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(ctxMenuPrevented(shield)).toBe(true);
      expect(ctxMenuPrevented(img)).toBe(true);
    }
    expect(screen.getByTestId("tile-0").closest(".img-protect")).toBeTruthy();
  });
  it("protect: keyboard open and the open button still work", () => {
    const onOpen = vi.fn();
    render(<Grid photos={photos(2)} t={t} onOpen={onOpen} protect />);
    fireEvent.click(screen.getByTestId("shield-1"));
    expect(onOpen).toHaveBeenLastCalledWith(1);
    const btn = screen.getByRole("button", { name: "Photo 1" });
    expect(btn.getAttribute("tabindex")).not.toBe("-1");
  });
  it("no protect: no overlay and the context menu is untouched", () => {
    render(<Grid photos={photos(2)} t={t} onOpen={() => {}} />);
    expect(screen.queryByTestId("shield-0")).toBeNull();
    expect(
      ctxMenuPrevented(screen.getByTestId("tile-0").querySelector("img")!),
    ).toBe(false);
    expect(document.querySelector(".img-protect")).toBeNull();
  });
});

describe("Lightbox image protection", () => {
  const props = {
    photos: photos(4),
    index: 1,
    t,
    onClose: () => {},
    onIndexChange: () => {},
  };
  it("protect: overlay above the image, contextmenu prevented, draggable false", () => {
    render(<Lightbox {...props} protect />);
    const img = screen.getByTestId("lightbox-img");
    const shield = screen.getByTestId("lightbox-shield");
    expect(img.getAttribute("draggable")).toBe("false");
    expect(
      img.compareDocumentPosition(shield) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(ctxMenuPrevented(shield)).toBe(true);
    expect(ctxMenuPrevented(img)).toBe(true);
    expect(img.closest(".img-protect")).toBeTruthy();
  });
  it("protect: arrow keys and Escape still work", () => {
    const onIndexChange = vi.fn();
    const onClose = vi.fn();
    render(
      <Lightbox
        {...props}
        onIndexChange={onIndexChange}
        onClose={onClose}
        protect
      />,
    );
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenCalledWith(2);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
  it("no protect: no overlay", () => {
    render(<Lightbox {...props} />);
    expect(screen.queryByTestId("lightbox-shield")).toBeNull();
    expect(ctxMenuPrevented(screen.getByTestId("lightbox-img"))).toBe(false);
  });
});

describe("protection CSS", () => {
  it(".img-protect disables callout and selection", () => {
    const css = readFileSync("app/app.css", "utf8");
    const m = /\.img-protect\s*{([^}]*)}/.exec(css);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/-webkit-touch-callout:\s*none/);
    expect(m![1]).toMatch(/user-select:\s*none/);
  });
});

function stub(node: ReactNode) {
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
const gallery = (over: Partial<OpenGallery> = {}): OpenGallery => ({
  slug: "boda",
  requireEmail: false,
  title: "Boda",
  eventDate: null,
  clientName: null,
  coverPhotoId: "p0",
  allowBulk: true,
  allowHighres: true,
  allowWeb: true,
  allowIg: true,
  mode: "delivery",
  theme: "light",
  sets: [{ name: "A", count: 3 }],
  ...over,
});

describe("GalleryView per mode", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ visitor: null, favorites: [] })),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proofing: no download buttons anywhere, favorites stay, images protected", async () => {
    stub(
      <GalleryView
        gallery={gallery({ mode: "proofing" })}
        photos={photos(3)}
      />,
    );
    await screen.findByTestId("tile-0");
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.queryAllByLabelText("Download")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Favorites" })).toBeTruthy();
    expect(screen.getByTestId("shield-0")).toBeTruthy();
    expect(screen.getByTestId("cover-shield")).toBeTruthy();
    fireEvent.click(screen.getByTestId("open-0"));
    expect(await screen.findByTestId("lightbox-shield")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });
  it("proofing hides downloads even if the payload still carried allow flags", async () => {
    stub(
      <GalleryView
        gallery={gallery({ mode: "proofing", allowHighres: true })}
        photos={photos(1)}
      />,
    );
    await screen.findByTestId("tile-0");
    expect(screen.queryAllByLabelText("Download")).toHaveLength(0);
  });
  it("delivery: download button present, no overlays", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos(3)} />);
    await screen.findByTestId("tile-0");
    expect(screen.getAllByLabelText("Download").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("shield-0")).toBeNull();
    expect(screen.queryByTestId("cover-shield")).toBeNull();
    const ev = createEvent.contextMenu(screen.getByTestId("tile-0"));
    fireEvent(screen.getByTestId("tile-0"), ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
