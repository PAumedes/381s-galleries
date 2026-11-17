import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Lightbox } from "../../app/components/Lightbox";
import { DownloadMenu } from "../../app/components/DownloadMenu";
import type { GalleryPhoto, OpenGallery } from "../../app/components/types";
import * as client from "../../app/lib/download-client";
import { t } from "./fixtures";

vi.mock("../../app/lib/download-client", async (orig) => ({
  ...(await orig<typeof import("../../app/lib/download-client")>()),
  downloadSingle: vi.fn(async () => {}),
  downloadBulk: vi.fn(),
}));

const gallery = (over: Partial<OpenGallery> = {}): OpenGallery => ({
  slug: "boda",
  requireEmail: false,
  title: "Boda",
  eventDate: null,
  coverPhotoId: null,
  allowBulk: true,
  allowHighres: true,
  allowWeb: true,
  allowIg: true,
  sets: [
    { name: "Ceremonia", count: 2 },
    { name: "Fiesta", count: 2 },
  ],
  ...over,
});
const mkPhotos = (
  n: number,
  over: Partial<GalleryPhoto> = {},
): GalleryPhoto[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    width: 3000,
    height: 2000,
    set: i < n / 2 ? "Ceremonia" : "Fiesta",
    variants: { web: true, ig: true },
    ...over,
  }));
const ensure = async (a: () => void | Promise<void>) => a();

const dl = vi.mocked(client.downloadSingle);
const bulk = vi.mocked(client.downloadBulk);
beforeEach(() => {
  dl.mockClear();
  bulk.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function single(g = gallery(), photo = mkPhotos(1)[0], onClose = vi.fn()) {
  render(
    <DownloadMenu
      gallery={g}
      t={t}
      ensure={ensure}
      onClose={onClose}
      mode={{ kind: "single", photo }}
    />,
  );
  return onClose;
}

describe("DownloadMenu single", () => {
  it("is a titled dialog listing every enabled size", () => {
    single();
    const dlg = screen.getByRole("dialog", { name: "Download photo" });
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    const rows = within(dlg)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(rows).toContain("High resolution · 2048 px");
    expect(rows).toContain("Web · 1200 px");
    expect(rows).toContain("Instagram · 1080 px");
  });

  it("hides sizes the gallery disallows", () => {
    single(gallery({ allowWeb: false }));
    expect(screen.queryByText("Web · 1200 px")).toBeNull();
    expect(screen.getByText("High resolution · 2048 px")).toBeTruthy();
  });

  it("hides sizes this photo does not have", () => {
    single(gallery(), mkPhotos(1, { variants: { web: false, ig: true } })[0]);
    expect(screen.queryByText("Web · 1200 px")).toBeNull();
    expect(screen.getByText("Instagram · 1080 px")).toBeTruthy();
  });

  it("clicking a size downloads it and closes the sheet", async () => {
    const onClose = single();
    await act(async () => {
      fireEvent.click(screen.getByText("Web · 1200 px"));
    });
    expect(dl).toHaveBeenCalledWith("boda", "p0", "web");
    expect(onClose).toHaveBeenCalled();
  });

  it("reports a failed download through onError", async () => {
    dl.mockRejectedValueOnce(new Error("boom"));
    const onError = vi.fn();
    render(
      <DownloadMenu
        gallery={gallery()}
        t={t}
        ensure={ensure}
        onClose={() => {}}
        onError={onError}
        mode={{ kind: "single", photo: mkPhotos(1)[0] }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText("Web · 1200 px"));
    });
    expect(onError).toHaveBeenCalled();
  });

  it("closes on Escape and traps Tab", () => {
    const onClose = single();
    const rows = within(screen.getByRole("dialog")).getAllByRole("button");
    rows[rows.length - 1].focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("uses the sheet z-layer token and square, shadowless styling", () => {
    single();
    const html = document.body.innerHTML;
    expect(html).toContain("z-(--z-sheet)");
    expect(html).not.toMatch(/rounded|shadow/);
  });
});

function bulkMenu(
  over: {
    g?: OpenGallery;
    photos?: GalleryPhoto[];
    activeSet?: string | null;
    favs?: string[];
    onClose?: () => void;
  } = {},
) {
  const photos = over.photos ?? mkPhotos(4);
  const onClose = over.onClose ?? vi.fn();
  render(
    <DownloadMenu
      gallery={over.g ?? gallery()}
      t={t}
      ensure={ensure}
      onClose={onClose}
      mode={{
        kind: "bulk",
        photos,
        activeSet: over.activeSet ?? null,
        favoriteIds: new Set(over.favs ?? []),
      }}
    />,
  );
  return onClose;
}

describe("DownloadMenu bulk", () => {
  it("offers the whole gallery, plus set / favorites only when relevant", () => {
    bulkMenu();
    expect(screen.getByLabelText("Entire gallery")).toBeTruthy();
    expect(screen.queryByLabelText(/Section ·/)).toBeNull();
    expect(screen.queryByLabelText(/Favorites/)).toBeNull();
  });

  it("adds the active set and favorites scopes", () => {
    bulkMenu({ activeSet: "Fiesta", favs: ["p0"] });
    expect(screen.getByLabelText("Section · Fiesta")).toBeTruthy();
    expect(screen.getByLabelText("Favorites")).toBeTruthy();
  });

  it("shows the photo count and approximate size, following scope and size", () => {
    bulkMenu({ activeSet: "Fiesta", photos: mkPhotos(4, {}) });
    expect(screen.getByText(/4 photos/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Section · Fiesta"));
    expect(screen.getByText(/2 photos/)).toBeTruthy();
  });

  it("only counts photos that have the chosen size", () => {
    const photos = mkPhotos(4);
    photos[0] = { ...photos[0], variants: { web: false, ig: true } };
    bulkMenu({ photos });
    fireEvent.click(screen.getByLabelText("Web · 1200 px"));
    expect(screen.getByText(/3 photos/)).toBeTruthy();
  });

  it("starts the download with scope, size and the set map, then shows progress", async () => {
    let report!: (p: client.BulkProgress) => void;
    let finish!: (r: client.BulkResult) => void;
    bulk.mockImplementation(async (o) => {
      report = o.onProgress!;
      return new Promise((r) => (finish = r));
    });
    bulkMenu({ activeSet: "Fiesta" });
    fireEvent.click(screen.getByLabelText("Section · Fiesta"));
    fireEvent.click(screen.getByLabelText("Instagram · 1080 px"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    const arg = bulk.mock.calls[0][0];
    expect(arg).toMatchObject({
      slug: "boda",
      scope: "set",
      set: "Fiesta",
      variant: "ig",
    });
    expect(arg.sets?.get("p3")).toBe("Fiesta");
    expect(arg.signal).toBeInstanceOf(AbortSignal);

    act(() => report({ done: 1, total: 2, bytes: 10, failed: [] }));
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe("2");
    expect(screen.getByText("1 / 2")).toBeTruthy();

    await act(async () =>
      finish({
        done: 2,
        total: 2,
        bytes: 20,
        failed: ["x.jpg"],
        status: "done",
        sink: "blob",
      }),
    );
    expect(screen.getByText("Download complete")).toBeTruthy();
    expect(screen.getByText("1 file couldn't be downloaded")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("cancel aborts the signal and says so", async () => {
    let signal!: AbortSignal;
    bulk.mockImplementation(
      (o) =>
        new Promise((resolve) => {
          signal = o.signal!;
          signal.addEventListener("abort", () =>
            resolve({
              done: 0,
              total: 4,
              bytes: 0,
              failed: [],
              status: "cancelled",
              sink: "blob",
            }),
          );
        }),
    );
    bulkMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(signal.aborted).toBe(true);
    expect(screen.getByText("Download cancelled")).toBeTruthy();
  });

  const hang = () => {
    let signal!: AbortSignal;
    bulk.mockImplementation(
      (o) =>
        new Promise((resolve) => {
          signal = o.signal!;
          signal.addEventListener("abort", () =>
            resolve({
              done: 0,
              total: 4,
              bytes: 0,
              failed: [],
              status: "cancelled",
              sink: "blob",
            }),
          );
        }),
    );
    return () => signal;
  };

  it("asks before closing a running download (Escape, then No keeps it)", async () => {
    const sig = hang();
    const onClose = bulkMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("Cancel the download?")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(sig().aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(screen.queryByText("Cancel the download?")).toBeNull();
    expect(sig().aborted).toBe(false);
  });

  it("confirming Yes aborts the running download", async () => {
    const sig = hang();
    bulkMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    });
    expect(sig().aborted).toBe(true);
  });

  it("asks before the backdrop closes a running download", async () => {
    hang();
    const onClose = bulkMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Cancel the download?")).toBeTruthy();
  });

  it("starts only once on a double click", async () => {
    hang();
    bulkMenu();
    const btn = screen.getByRole("button", { name: "Download" });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(bulk).toHaveBeenCalledTimes(1);
  });

  it("warns before starting when the download would be large without a file picker", () => {
    vi.stubGlobal("showSaveFilePicker", undefined);
    bulkMenu({ photos: mkPhotos(1500) });
    fireEvent.click(screen.getByLabelText("Web · 1200 px"));
    expect(screen.getByRole("note").textContent).toMatch(
      /by section|computer/i,
    );
  });

  it("does not warn for a small gallery", () => {
    vi.stubGlobal("showSaveFilePicker", undefined);
    bulkMenu();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("shows an error and returns to the form when starting fails", async () => {
    bulk.mockRejectedValueOnce(new client.DownloadError("http", 500));
    bulkMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/try again/i);
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });

  it("only offers enabled sizes", () => {
    bulkMenu({ g: gallery({ allowHighres: false, allowIg: false }) });
    expect(screen.queryByLabelText("High resolution · 2048 px")).toBeNull();
    expect(screen.queryByLabelText("Instagram · 1080 px")).toBeNull();
    expect(screen.getByLabelText("Web · 1200 px")).toBeTruthy();
  });
});

describe("DownloadMenu accessibility", () => {
  const hangBulk = () =>
    bulk.mockImplementation(
      (o) =>
        new Promise((resolve) => {
          o.signal!.addEventListener("abort", () =>
            resolve({
              done: 0,
              total: 4,
              bytes: 0,
              failed: [],
              status: "cancelled",
              sink: "blob",
            }),
          );
        }),
    );

  it("moves focus to Cancel while running and to Close when done", async () => {
    let finish!: (r: client.BulkResult) => void;
    bulk.mockImplementation(() => new Promise((r) => (finish = r)));
    bulkMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    await act(async () =>
      finish({
        done: 4,
        total: 4,
        bytes: 1,
        failed: [],
        status: "done",
        sink: "blob",
      }),
    );
    const active = document.activeElement as HTMLElement;
    expect(active.textContent).toBe("Close");
    expect(screen.getByRole("dialog").contains(active)).toBe(true);
  });

  it("announces done and cancelled as status", async () => {
    hangBulk();
    bulkMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(screen.getByRole("status").textContent).toBe("Download cancelled");
  });

  it("the cancel confirmation is a labelled alertdialog and takes focus", async () => {
    hangBulk();
    bulkMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    fireEvent.keyDown(document, { key: "Escape" });
    const alert = screen.getByRole("alertdialog", {
      name: "Cancel the download?",
    });
    expect(alert.contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
  });

  it("a failed save dialog asks with its own message and continues in memory on Continue", async () => {
    let ask!: () => Promise<boolean>;
    let result!: Promise<boolean>;
    bulk.mockImplementation(async (o) => {
      ask = o.confirmFallback!;
      return new Promise(() => {});
    });
    bulkMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    await act(async () => {
      result = ask();
    });
    expect(screen.getByRole("note").textContent).toBe(
      "Couldn't open the save dialog. Continue in memory?",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(await result).toBe(true);
  });

  it("a large server-side total asks with the large warning", async () => {
    let ask!: () => Promise<boolean>;
    bulk.mockImplementation(async (o) => {
      ask = o.confirmLarge!;
      return new Promise(() => {});
    });
    vi.stubGlobal("showSaveFilePicker", undefined);
    bulkMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download" }));
    });
    await act(async () => {
      void ask();
    });
    expect(screen.getByRole("note").textContent).toMatch(/hold it in memory/);
  });

  it("Escape inside the sheet never reaches a Lightbox underneath", async () => {
    hangBulk();
    const onLightboxClose = vi.fn();
    const onSheetClose = vi.fn();
    render(
      <>
        <Lightbox
          photos={mkPhotos(4)}
          index={1}
          t={t}
          onClose={onLightboxClose}
          onIndexChange={() => {}}
        />
        <DownloadMenu
          gallery={gallery()}
          t={t}
          ensure={ensure}
          onClose={onSheetClose}
          mode={{
            kind: "bulk",
            photos: mkPhotos(4),
            activeSet: null,
            favoriteIds: new Set(),
          }}
        />
      </>,
    );
    const inside = screen.getByLabelText("Entire gallery");
    inside.focus();
    fireEvent.keyDown(inside, { key: "Escape" });
    expect(onSheetClose).toHaveBeenCalledTimes(1);
    expect(onLightboxClose).not.toHaveBeenCalled();
    // Event dispatched on the document while focus is inside the sheet.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onLightboxClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "ArrowRight" });
  });
});

describe("DownloadMenu Escape with another dialog above", () => {
  it("does not close or swallow Escape pressed inside a stacked dialog (focus fallback)", () => {
    const onClose = single();
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    const btn = document.createElement("button");
    other.appendChild(btn);
    document.body.appendChild(other);
    btn.focus();
    const seen = vi.fn();
    other.addEventListener("keydown", seen);
    // target is body (not inside the other dialog) but focus is
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(btn, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(seen).toHaveBeenCalledTimes(1);
    other.remove();
  });

  it("still closes on Escape from inside its own sheet", () => {
    const onClose = single();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
