import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../../app/i18n/en";
import { GalleryView } from "../../app/components/GalleryView";
import type { OpenGallery } from "../../app/components/types";

const photos = [0, 1].map((i) => ({
  id: `p${i}`,
  width: 3000,
  height: 2000,
  set: "A",
  variants: { web: true, ig: false },
}));
const gallery: OpenGallery = {
  slug: "boda",
  requireEmail: false,
  title: "Boda",
  eventDate: null,
  clientName: null,
  coverPhotoId: null,
  allowBulk: true,
  allowHighres: true,
  allowWeb: true,
  allowIg: true,
  sets: [{ name: "A", count: 2 }],
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/favorites") && (init?.method ?? "GET") === "GET")
        return json({ visitor: null, favorites: [] });
      if (url.endsWith("/favorites")) return json({ error: "x" }, 500);
      if (url.endsWith("/download-tokens")) return json({ error: "x" }, 500);
      return json({}, 404);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("toasts", () => {
  it("shows one toast at a time: a download error replaces a favorites error", async () => {
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        loader: () => ({ lang: "en", messages: en, studioName: "381 Studios" }),
        Component: () => <GalleryView gallery={gallery} photos={photos} />,
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    const tile = await screen.findByTestId("tile-0");
    await act(async () => {
      fireEvent.click(
        within(tile).getByRole("button", { name: "Add to favorites" }),
      );
    });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe(en["favorites.error"]);
    await act(async () => {
      fireEvent.click(within(tile).getByRole("button", { name: "Download" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("High resolution · 2048 px"));
    });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe(en["download.error"]);
  });
});
