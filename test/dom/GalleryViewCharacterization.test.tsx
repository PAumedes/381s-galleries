import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../../app/i18n/en";
import { GalleryView } from "../../app/components/GalleryView";
import type { OpenGallery } from "../../app/components/types";

const photos = ["Cer0", "Cer1", "Cer2", "Fie0", "Fie1"].map((id, i) => ({
  id,
  width: i === 1 ? 2000 : 3000,
  height: i === 1 ? 3000 : 2000,
  set: id.startsWith("Cer") ? "Ceremonia" : "Fiesta",
  variants: { web: true, ig: i % 2 === 0 },
  v: `v${i}`,
}));

const gallery = (over: Partial<OpenGallery> = {}): OpenGallery => ({
  slug: "boda",
  requireEmail: false,
  title: "Boda Ana",
  eventDate: "2026-03-14",
  coverPhotoId: "Cer0",
  coverFocus: { x: 30, y: 40 },
  allowBulk: true,
  allowHighres: true,
  allowWeb: true,
  allowIg: false,
  mode: "delivery",
  palette: "claro",
  coverLayout: "completa",
  gridStyle: "filas",
  gridGap: "normal",
  sets: [
    { name: "Ceremonia", count: 3 },
    { name: "Fiesta", count: 2 },
  ],
  ...over,
});

async function show(g: OpenGallery, preview = false) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "en", messages: en, studioName: "381 Studios" }),
      Component: () => (
        <GalleryView gallery={g} photos={photos} preview={preview} />
      ),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
  await screen.findByRole("heading", { name: "Boda Ana" });
}
const html = () => document.body.innerHTML;

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
  cleanup();
  vi.unstubAllGlobals();
});

describe("T6.48 GalleryView markup (golden, pre-refactor)", () => {
  it("multi-set delivery: initial, tab, lightbox, bulk sheet", async () => {
    await show(gallery());
    expect(html()).toMatchSnapshot("initial");
    fireEvent.click(screen.getByRole("button", { name: "Fiesta" }));
    expect(html()).toMatchSnapshot("fiesta tab");
    fireEvent.click(document.querySelector("#grid button, #grid a") as Element);
    expect(html()).toMatchSnapshot("lightbox open");
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(
      document.querySelector('nav button[aria-label="Download"]') as Element,
    );
    expect(html()).toMatchSnapshot("after escape/bulk");
  });
  it("favourite flow: empty favourites tab", async () => {
    await show(gallery());
    const fav = document.querySelector("nav button[aria-pressed]") as Element;
    await act(async () => {
      fireEvent.click(fav);
    });
    expect(html()).toMatchSnapshot("fav tab empty");
  });
  it("single set, proofing, dark palette, mobile cover", async () => {
    await show(
      gallery({
        mode: "proofing",
        palette: "oscuro",
        coverLayout: "dividida",
        gridStyle: "columnas",
        gridGap: "amplio",
        sets: [{ name: "Ceremonia", count: 3 }],
        coverPhotoIdMobile: "Fie1",
        coverFocusMobile: { x: 10, y: 90 },
      }),
    );
    expect(html()).toMatchSnapshot();
  });
  it("preview mode", async () => {
    await show(gallery(), true);
    expect(html()).toMatchSnapshot();
  });
});
