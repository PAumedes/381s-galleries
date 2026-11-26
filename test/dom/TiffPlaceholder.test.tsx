import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BulkChooseView } from "../../app/components/DownloadBulkViews";
import { DownloadMenu } from "../../app/components/DownloadMenu";
import { Grid } from "../../app/components/Grid";
import { Lightbox } from "../../app/components/Lightbox";
import type { GalleryPhoto, OpenGallery } from "../../app/components/types";
import * as client from "../../app/lib/download-client";
import { es } from "../../app/i18n/es";
import { en } from "../../app/i18n/en";
import { makeT } from "../../app/i18n/t";
import { photos, t } from "./fixtures";

vi.mock("../../app/lib/download-client", async (orig) => ({
  ...(await orig<typeof import("../../app/lib/download-client")>()),
  downloadSingle: vi.fn(async () => {}),
}));
const dl = vi.mocked(client.downloadSingle);
beforeEach(() => dl.mockClear());
afterEach(cleanup);

/** T6.53d: the placeholder card for a photo with no image to show (TIFF-only). */
const tiffPhoto = (
  id: string,
  over: Partial<GalleryPhoto> = {},
): GalleryPhoto => ({
  id,
  width: null,
  height: null,
  set: "A",
  variants: { web: false, ig: false },
  noPreview: true,
  tiff: { name: `IMG_${id}.tif`, bytes: 312 * 1024 * 1024 },
  ...over,
});
const mixed = (): GalleryPhoto[] => [
  photos(1)[0],
  tiffPhoto("T1"),
  { ...photos(3)[2], id: "p2" },
];

describe("T6.53d grid placeholder tile", () => {
  it("shows the text, file name and size instead of an image, keeps the open button", () => {
    const onOpen = vi.fn();
    render(<Grid photos={mixed()} t={t} onOpen={onOpen} />);
    const tile = screen.getByTestId("tile-1");
    expect(within(tile).queryByRole("img")).toBeNull();
    expect(tile.querySelector("img")).toBeNull();
    expect(within(tile).getByText("Preview not available")).toBeTruthy();
    expect(within(tile).getByText("IMG_T1.tif")).toBeTruthy();
    expect(within(tile).getByText(/312 MB/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("open-1"));
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it("a fixed-ratio slot (3:2) and no retry button, other tiles untouched", () => {
    render(
      <Grid
        photos={mixed()}
        t={t}
        onOpen={() => {}}
        layout="columnas"
        initialWidth={1200}
      />,
    );
    const box = screen.getByTestId("tile-1").style;
    expect(
      Math.round((parseFloat(box.width) / parseFloat(box.height)) * 10),
    ).toBe(15);
    expect(screen.queryByTestId("retry-1")).toBeNull();
    expect(screen.getByTestId("tile-0").querySelector("img")).not.toBeNull();
  });

  it("has a download button when downloads are wired; it asks for that photo and never opens the lightbox", () => {
    const onDownload = vi.fn();
    const onOpen = vi.fn();
    render(
      <Grid photos={mixed()} t={t} onOpen={onOpen} onDownload={onDownload} />,
    );
    fireEvent.click(
      within(screen.getByTestId("tile-1")).getByRole("button", {
        name: "Download original",
      }),
    );
    expect(onDownload).toHaveBeenCalledWith("T1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("has no download button in Prueba (no onDownload)", () => {
    render(<Grid photos={mixed()} t={t} onOpen={() => {}} />);
    expect(
      within(screen.getByTestId("tile-1")).queryByRole("button", {
        name: "Download original",
      }),
    ).toBeNull();
  });

  it("a TIFF with previews (no noPreview) is an ordinary image tile", () => {
    const withImg = tiffPhoto("T2", {
      noPreview: undefined,
      width: 3000,
      height: 2000,
    });
    render(<Grid photos={[withImg]} t={t} onOpen={() => {}} />);
    expect(screen.getByTestId("tile-0").querySelector("img")).not.toBeNull();
    expect(screen.queryByText("Preview not available")).toBeNull();
  });

  it("a missing size is not printed as 0 MB", () => {
    render(
      <Grid
        photos={[tiffPhoto("T3", { tiff: { name: "x.tif", bytes: null } })]}
        t={t}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByTestId("tile-0").textContent).not.toMatch(/MB/);
  });

  it("is Spanish too, with no straight quotes", () => {
    const es$ = makeT("es", es);
    render(
      <Grid
        photos={[tiffPhoto("T4")]}
        t={es$}
        onOpen={() => {}}
        onDownload={() => {}}
      />,
    );
    expect(screen.getByText("Vista previa no disponible")).toBeTruthy();
    expect(
      es["preview.unavailable"] +
        es["preview.download"] +
        en["preview.unavailable"],
    ).not.toMatch(/["']/);
  });
});

function lightbox(
  list: GalleryPhoto[],
  index: number,
  extra: Partial<React.ComponentProps<typeof Lightbox>> = {},
) {
  return render(
    <Lightbox
      photos={list}
      index={index}
      t={t}
      onClose={vi.fn()}
      onIndexChange={vi.fn()}
      {...extra}
    />,
  );
}

describe("T6.53d lightbox placeholder", () => {
  it("the stage shows the card (no image requests for it) with name, size and the download button", () => {
    const onDownload = vi.fn();
    lightbox(mixed(), 1, { onDownload });
    const card = screen.getByTestId("lightbox-preview-card");
    expect(within(card).getByText("Preview not available")).toBeTruthy();
    expect(within(card).getByText("IMG_T1.tif")).toBeTruthy();
    expect(screen.queryByTestId("lightbox-img")).toBeNull();
    expect(screen.queryByTestId("lightbox-placeholder")).toBeNull();
    expect(screen.queryByTestId("lightbox-error")).toBeNull();
    expect(document.querySelector('img[src*="/img/T1/"]')).toBeNull();
    fireEvent.click(
      within(card).getByRole("button", { name: "Download original" }),
    );
    expect(onDownload).toHaveBeenCalledWith("T1");
  });

  it("no download button without onDownload (Prueba); the card still shows", () => {
    lightbox(mixed(), 1);
    expect(
      within(screen.getByTestId("lightbox-preview-card")).queryByRole("button"),
    ).toBeNull();
  });

  it("neighbours that are placeholders are never preloaded or drawn as images", () => {
    lightbox(mixed(), 0);
    expect(document.querySelector('img[src*="/img/T1/"]')).toBeNull();
    expect(screen.getByTestId("lightbox-img")).toBeTruthy();
  });

  it("moving from the card to a normal photo shows that photo, not the one before the card", () => {
    const onIndexChange = vi.fn();
    const { rerender } = lightbox(mixed(), 1, { onIndexChange });
    rerender(
      <Lightbox
        photos={mixed()}
        index={2}
        t={t}
        onClose={vi.fn()}
        onIndexChange={onIndexChange}
      />,
    );
    expect(screen.queryByTestId("lightbox-preview-card")).toBeNull();
    expect(screen.getByTestId("lightbox-img").getAttribute("src")).toContain(
      "/img/p2/",
    );
    expect(screen.queryByTestId("lightbox-prev")).toBeNull();
  });
});

describe("T6.53d download sheet and bulk", () => {
  const gallery: OpenGallery = {
    slug: "boda",
    requireEmail: false,
    title: "B",
    eventDate: null,
    coverPhotoId: null,
    allowBulk: true,
    allowHighres: true,
    allowWeb: true,
    allowIg: true,
    mode: "delivery",
    sets: [{ name: "A", count: 3 }],
  } as OpenGallery;
  const ensure = async (a: () => void | Promise<void>) => a();

  it("a TIFF original is offered as 'TIFF original' with its size and downloads the high-res", async () => {
    render(
      <DownloadMenu
        gallery={gallery}
        t={t}
        ensure={ensure}
        onClose={() => {}}
        mode={{ kind: "single", photo: tiffPhoto("T1") }}
      />,
    );
    expect(screen.queryByText(/2048 px/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByText("TIFF original · 312 MB"));
    });
    expect(dl).toHaveBeenCalledWith("boda", "T1", "highres");
  });

  it("an ordinary photo keeps its sizes", () => {
    render(
      <DownloadMenu
        gallery={gallery}
        t={t}
        ensure={ensure}
        onClose={() => {}}
        mode={{ kind: "single", photo: photos(1)[0] }}
      />,
    );
    expect(screen.getByText("High resolution · 2048 px")).toBeTruthy();
  });

  it("bulk high-res: TIFF photos are not counted and a note says they are downloaded one by one", () => {
    const props = {
      t,
      scopes: [{ key: "all" as const, label: "Entire gallery" }],
      scope: "all" as const,
      setScope: () => {},
      sizes: [
        { variant: "highres" as const, key: "download.highres" as const },
      ],
      variant: "highres" as const,
      setVariant: () => {},
      count: 2,
      warning: null,
      error: false,
      startRef: { current: null },
      disabled: false,
      onStart: () => {},
    };
    const { rerender } = render(<BulkChooseView {...props} tiffSkipped={3} />);
    expect(screen.getByText(/3 TIFF files/)).toBeTruthy();
    rerender(<BulkChooseView {...props} tiffSkipped={0} />);
    expect(screen.queryByText(/TIFF/)).toBeNull();
  });
});
