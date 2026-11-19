import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { CoverHero } from "../../app/components/CoverHero";
import { en } from "../../app/i18n/en";
import type { CoverLayout, Palette } from "../../app/lib/design";

function show(
  layout: CoverLayout | undefined,
  over: {
    embedded?: boolean;
    src?: string | null;
    proofing?: boolean;
    palette?: Palette;
  } = {},
) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "en", messages: en, studioName: "381 Studios" }),
      Component: () => (
        <CoverHero
          title="Boda Ana"
          date="1 November 2026"
          studio="381 Studios"
          src={over.src === undefined ? "/img/p0/view-lg" : over.src}
          proofing={over.proofing ?? false}
          focus={null}
          scrollLabel="View gallery"
          onScroll={() => {}}
          layout={layout}
          palette={over.palette}
          embedded={over.embedded}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}
const root = () => document.querySelector<HTMLElement>("[data-cover-layout]")!;
const img = () => document.querySelector("img[data-cover-img]");

describe("CoverHero layouts", () => {
  it("defaults to completa: full-bleed image behind the title, full viewport", async () => {
    show(undefined);
    await screen.findByRole("heading", { level: 1, name: "Boda Ana" });
    expect(root().dataset.coverLayout).toBe("completa");
    expect(root().className).toMatch(/h-dvh/);
    expect(root().contains(img())).toBe(true);
    expect(document.querySelector("[data-cover-pane]")).toBeNull();
  });

  it("dividida: image pane (60%) and a title pane on the palette background", async () => {
    show("dividida", { palette: "arena" });
    const h1 = await screen.findByRole("heading", { level: 1 });
    const imagePane = root().querySelector('[data-cover-pane="image"]')!;
    const textPane = root().querySelector('[data-cover-pane="text"]')!;
    expect(imagePane.contains(img())).toBe(true);
    expect(textPane.contains(h1)).toBe(true);
    expect(textPane.contains(img())).toBe(false);
    expect(textPane.className).toMatch(/bg-paper/);
    expect(textPane.className).toMatch(/text-ink/);
    // image first (left / top on mobile), 3:2 split
    expect(imagePane.compareDocumentPosition(textPane)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(imagePane.className).toMatch(/flex-3|basis-3\/5|w-3\/5|flex-\[3\]/);
    expect(textPane.textContent).toContain("1 November 2026");
    expect(textPane.querySelector("button")).toBeTruthy();
  });

  it("dividida uses the black logo on a light palette and the white one on oscuro", async () => {
    show("dividida", { palette: "gris" });
    await screen.findByRole("heading", { level: 1 });
    const pane = () => root().querySelector('[data-cover-pane="text"]')!;
    expect(pane().querySelector("[data-logo=wordmark]")!.className).toMatch(
      /text-black/,
    );
  });
  it("dividida on oscuro uses the white logo", async () => {
    show("dividida", { palette: "oscuro" });
    await screen.findByRole("heading", { level: 1 });
    expect(
      root().querySelector('[data-cover-pane="text"] [data-logo=wordmark]')!
        .className,
    ).toMatch(/text-white/);
  });

  it("centrada: framed image (with margins), title centered below it", async () => {
    show("centrada");
    const h1 = await screen.findByRole("heading", { level: 1 });
    const frame = root().querySelector("[data-cover-frame]")!;
    expect(frame.contains(img())).toBe(true);
    expect(frame.contains(h1)).toBe(false);
    expect(
      frame.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(root().className).toMatch(/bg-paper/);
    expect(root().className).not.toMatch(/bg-night/);
    expect(root().className).toMatch(/text-center|items-center/);
  });

  it("minima: no image hero at all, just title and date; no scroll cue", async () => {
    show("minima");
    await screen.findByRole("heading", { level: 1, name: "Boda Ana" });
    expect(img()).toBeNull();
    expect(root().querySelector("img[src^='/img']")).toBeNull();
    expect(root().textContent).toContain("1 November 2026");
    expect(root().className).not.toMatch(/h-dvh/);
    expect(screen.queryByRole("button", { name: "View gallery" })).toBeNull();
  });

  it("every layout: one h1 (public) / a paragraph (embedded), same title", async () => {
    for (const l of ["completa", "dividida", "centrada", "minima"] as const) {
      const { unmount } = show(l);
      expect(await screen.findAllByRole("heading", { level: 1 })).toHaveLength(
        1,
      );
      unmount();
      const e = show(l, { embedded: true });
      await screen.findByText("Boda Ana");
      expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      e.unmount();
    }
  });

  it("proofing shield covers the image in layouts that show one, none in minima", async () => {
    for (const l of ["completa", "dividida", "centrada"] as const) {
      const { unmount } = show(l, { proofing: true });
      await screen.findByRole("heading", { level: 1 });
      expect(screen.getByTestId("cover-shield")).toBeTruthy();
      unmount();
    }
    show("minima", { proofing: true });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByTestId("cover-shield")).toBeNull();
  });

  it("no cover photo: still renders title in every layout", async () => {
    for (const l of ["completa", "dividida", "centrada", "minima"] as const) {
      const { unmount } = show(l, { src: null });
      expect(await screen.findByText("Boda Ana")).toBeTruthy();
      expect(img()).toBeNull();
      unmount();
    }
  });
});
