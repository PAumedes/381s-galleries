import { cleanup, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "../../app/i18n/en";
import { GalleryRoutePage } from "../../app/components/GalleryRoutePage";
import type { OpenGallery } from "../../app/components/types";
import type { GalleryRouteData } from "../../app/lib/server/gallery-route";

const gallery = {
  slug: "boda",
  requireEmail: true,
  title: "Boda",
  eventDate: null,
  coverPhotoId: null,
  allowBulk: true,
  palette: "claro",
  coverLayout: "completa",
  gridStyle: "filas",
  gridGap: "normal",
  sets: [],
} as unknown as OpenGallery;
const mk = (over: object) =>
  ({
    state: "open",
    gallery,
    photos: [],
    origin: "https://x.test",
    ...over,
  }) as unknown as GalleryRouteData;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("T6.50 kept link outlives the album's client", () => {
  // Skipped: `rerender(<Stub/>)` never re-renders the route Component (RR memoizes
  // DataRoutes), so `data = mk({})` is never read; verified with a render log. The
  // same scenario runs with a real swap in test/dom/BackToClient.test.tsx
  // ("drops it when the same album is moved/unassigned").
  it.skip("album moved to another client / unassigned: revalidation without link must drop old client's link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ visitor: null, favorites: [] })),
      ),
    );
    let data = mk({
      clientSlug: "acme",
      backToClient: { name: "OLD CLIENT", href: "/acme" },
    });
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        loader: () => ({ lang: "en", messages: en, studioName: "x" }),
        Component: () => <GalleryRoutePage loaderData={data} />,
      },
    ]);
    const { rerender } = render(<Stub initialEntries={["/"]} />);
    await screen.findByRole("link", { name: "Back to OLD CLIENT" });
    data = mk({}); // now unassigned, no clientSlug, no link
    rerender(<Stub initialEntries={["/"]} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(
      screen.queryByRole("link", { name: "Back to OLD CLIENT" }),
    ).toBeNull();
  });
});
