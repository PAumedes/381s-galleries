import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoverHero } from "../../app/components/CoverHero";
import { Grid } from "../../app/components/Grid";
import { Lightbox } from "../../app/components/Lightbox";
import { adminImgSrc } from "../../app/components/img-url";
import { imgUrl, type GalleryPhoto } from "../../app/components/types";
import { en } from "../../app/i18n/en";
import { photos, t } from "./fixtures";

afterEach(cleanup);

/** Renders `node` inside a data router whose root loader provides English (the components read the language from it). */
async function inRouter(node: React.ReactNode) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "en", messages: en, studioName: "381 Studios" }),
      Component: () => node,
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

const versioned = (over: Partial<GalleryPhoto> = {}): GalleryPhoto => ({
  ...photos(1)[0],
  id: "A",
  v: "t2",
  ver: 2,
  versions: [
    { n: 1, round: null, at: "2026-03-01T15:00:00.000Z", v: "t1" },
    { n: 2, round: 2, at: "2026-03-05T15:00:00.000Z", v: "t2" },
  ],
  ...over,
});

describe("T6.53c image URLs", () => {
  it("a history entry adds ?ver=N; every other URL is exactly what it was", () => {
    expect(imgUrl("a b", "thumb")).toBe("/img/a%20b/thumb");
    expect(imgUrl("a", "thumb", "t")).toBe("/img/a/thumb?v=t");
    expect(imgUrl("a", "thumb", "t", 2)).toBe("/img/a/thumb?ver=2&v=t");
    expect(imgUrl("a", "view-sm", undefined, 3)).toBe("/img/a/view-sm?ver=3");
    expect(adminImgSrc("a", "thumb", "t")).toBe("/admin/img/a/thumb?v=t");
    expect(adminImgSrc("a", "thumb", "t", 2)).toBe("/admin/img/a/thumb?ver=2");
  });
});

describe("T6.53c grid badge", () => {
  it("only a photo flagged isNew carries 'New in this round'", () => {
    render(
      <Grid
        photos={[versioned({ isNew: true }), { ...photos(2)[1], id: "B" }]}
        t={t}
        onOpen={() => {}}
      />,
    );
    expect(screen.getAllByText("New in this round")).toHaveLength(1);
    const tile = screen.getByTestId("tile-0");
    expect(within(tile).getByText("New in this round")).toBeTruthy();
  });
  it("an unversioned grid has no badge", () => {
    render(<Grid photos={photos(3)} t={t} onOpen={() => {}} />);
    expect(screen.queryByText("New in this round")).toBeNull();
  });
});

describe("T6.53c album header", () => {
  const hero = (round?: string | null) =>
    inRouter(
      <CoverHero
        title="Retoque"
        date={null}
        studio="381"
        src={null}
        proofing={false}
        focus={null}
        scrollLabel="Ver"
        round={round}
      />,
    );
  it("shows the round when given and nothing otherwise", async () => {
    await hero("Round 3");
    expect(await screen.findByTestId("cover-round")).toBeTruthy();
    expect(screen.getByTestId("cover-round").textContent).toBe("Round 3");
    cleanup();
    await hero();
    await screen.findByRole("heading", { name: "Retoque" });
    expect(screen.queryByTestId("cover-round")).toBeNull();
  });
});

async function lightbox(photo: GalleryPhoto) {
  await inRouter(
    <Lightbox
      photos={[photo]}
      index={0}
      t={t}
      onClose={vi.fn()}
      onIndexChange={vi.fn()}
    />,
  );
}

describe("T6.53c lightbox history", () => {
  it("the main image is the plain latest URL; the history opens on demand with previews by ?ver=", async () => {
    const user = userEvent.setup();
    await lightbox(versioned());
    await screen.findByTestId("lightbox-img");
    expect(screen.getByTestId("lightbox-img").getAttribute("src")).toBe(
      "/img/A/view-sm?v=t2",
    );
    expect(screen.getByTestId("lightbox-version").textContent).toBe(
      "Version 2 · Round 2",
    );
    expect(screen.queryByTestId("versions-panel")).toBeNull();
    await user.click(screen.getByTestId("versions-toggle"));
    const panel = screen.getByTestId("versions-panel");
    expect(within(panel).getByTestId("version-1").textContent).toContain(
      "Initial delivery",
    );
    expect(within(panel).getByTestId("version-2").textContent).toContain(
      "Current",
    );
    expect(screen.getByTestId("versions-preview").getAttribute("src")).toBe(
      "/img/A/view-sm?ver=2&v=t2",
    );
    await user.click(screen.getByTestId("version-1"));
    expect(screen.getByTestId("versions-preview").getAttribute("src")).toBe(
      "/img/A/view-sm?ver=1&v=t1",
    );
    expect(screen.getByTestId("version-1").getAttribute("aria-pressed")).toBe(
      "true",
    );
    // Previews only: no link, no download control in the history.
    expect(panel.querySelectorAll("a, [download]")).toHaveLength(0);
    await user.click(screen.getByTestId("versions-toggle"));
    expect(screen.queryByTestId("versions-panel")).toBeNull();
  });

  it("a version without a history (one servable version) shows the caption only", async () => {
    await lightbox(versioned({ versions: undefined }));
    expect(await screen.findByTestId("lightbox-version")).toBeTruthy();
    expect(screen.queryByTestId("versions-toggle")).toBeNull();
  });

  it("an unversioned photo has no version UI at all", async () => {
    await lightbox(photos(1)[0]);
    await screen.findByTestId("lightbox-img");
    expect(screen.queryByTestId("lightbox-versions")).toBeNull();
  });
});
