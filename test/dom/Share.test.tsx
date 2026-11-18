import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { GalleryView } from "../../app/components/GalleryView";
import { PinScreen } from "../../app/components/PinScreen";
import { SharePanel } from "../../app/components/admin/SharePanel";
import type { OpenGallery } from "../../app/components/types";

function stub(node: ReactNode, lang: "en" | "es" = "en") {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang,
        messages: lang === "en" ? en : es,
        studioName: "381 Studios",
      }),
      Component: () => <>{node}</>,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

const gallery: OpenGallery = {
  slug: "boda-ana",
  requireEmail: false,
  title: "Boda Ana",
  eventDate: null,
  coverPhotoId: null,
  allowBulk: false,
  allowHighres: false,
  allowWeb: false,
  allowIg: false,
  mode: "delivery",
  palette: "claro",
  coverLayout: "completa",
  gridStyle: "filas",
  gridGap: "normal",
  sets: [{ name: "A", count: 1 }],
};
const photos = [{ id: "a0", width: 3000, height: 2000, set: "A" }];
const CANON = `${window.location.origin}/boda-ana`;

function setShare(fn: unknown) {
  Object.defineProperty(navigator, "share", {
    value: fn,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  window.history.pushState({}, "", "/boda-ana?lang=en&token=abc#x");
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
  delete (navigator as unknown as Record<string, unknown>).share;
});

describe("client gallery share", () => {
  it("uses navigator.share with title and canonical url", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setShare(share);
    stub(<GalleryView gallery={gallery} photos={photos} />);
    const btn = await screen.findByRole("button", { name: "Share" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0][0] as Record<string, string>;
    expect(arg.url).toBe(CANON);
    expect(arg.title).toBe("Boda Ana");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("AbortError leaves no popover", async () => {
    setShare(
      vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError")),
    );
    stub(<GalleryView gallery={gallery} photos={photos} />);
    const btn = await screen.findByRole("button", { name: "Share" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("other share errors fall back to the popover", async () => {
    setShare(vi.fn().mockRejectedValue(new Error("boom")));
    stub(<GalleryView gallery={gallery} photos={photos} />);
    const btn = await screen.findByRole("button", { name: "Share" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("without navigator.share shows popover with wa.me link containing the url", async () => {
    stub(<GalleryView gallery={gallery} photos={photos} />);
    const btn = await screen.findByRole("button", { name: "Share" });
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    await act(async () => {
      fireEvent.click(btn);
    });
    const dlg = screen.getByRole("dialog");
    const wa = within(dlg).getByRole("link", {
      name: "WhatsApp",
    }) as HTMLAnchorElement;
    const href = wa.getAttribute("href")!;
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(href.slice("https://wa.me/?text=".length));
    expect(text).toContain(CANON);
    expect(text).not.toContain("token");
    expect(wa.getAttribute("target")).toBe("_blank");
    expect(wa.getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(dlg).getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("popover follows the gallery language", async () => {
    stub(<GalleryView gallery={gallery} photos={photos} />, "es");
    const btn = await screen.findByRole("button", { name: "Compartir" });
    await act(async () => {
      fireEvent.click(btn);
    });
    const dlg = screen.getByRole("dialog");
    expect(
      within(dlg).getByRole("button", { name: "Copiar enlace" }),
    ).toBeTruthy();
    const wa = within(dlg).getByRole("link", { name: "WhatsApp" });
    expect(decodeURIComponent(wa.getAttribute("href")!)).toContain(
      es["gallery.shareMessage"].replace("{title}", "Boda Ana"),
    );
  });

  it("copy writes the canonical url and closes", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    stub(<GalleryView gallery={gallery} photos={photos} />);
    const shareBtn = await screen.findByRole("button", { name: "Share" });
    await act(async () => {
      fireEvent.click(shareBtn);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(writeText).toHaveBeenCalledWith(CANON);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Link copied");
  });

  it("Esc closes the popover and focus returns to the button", async () => {
    stub(<GalleryView gallery={gallery} photos={photos} />);
    const btn = await screen.findByRole("button", { name: "Share" });
    await act(async () => {
      fireEvent.click(btn);
    });
    const dlg = screen.getByRole("dialog");
    expect(dlg.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it("close button closes and returns focus", async () => {
    stub(<GalleryView gallery={gallery} photos={photos} />);
    const btn = await screen.findByRole("button", { name: "Share" });
    await act(async () => {
      fireEvent.click(btn);
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it("no share button on the locked (PIN) screen", async () => {
    stub(<PinScreen title="Boda Ana" />);
    await screen.findByRole("heading");
    expect(screen.queryByRole("button", { name: /share/i })).toBeNull();
  });
});

describe("admin share panel", () => {
  const props = {
    url: "https://g.example.com/boda-ana",
    slug: "boda-ana",
    title: "Boda Ana",
    status: "published" as const,
  };
  it("shows a WhatsApp link with the url and never the PIN", async () => {
    stub(<SharePanel {...props} hasPin />, "es");
    const wa = (await screen.findByRole("link", {
      name: /WhatsApp/,
    })) as HTMLAnchorElement;
    const href = wa.getAttribute("href")!;
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(href.slice("https://wa.me/?text=".length));
    expect(text).toContain(props.url);
    expect(text).not.toMatch(/pin/i);
    expect(wa.getAttribute("target")).toBe("_blank");
    expect(wa.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("button", { name: "Copiar enlace" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Compartir…" })).toBeNull();
  });
  it("Compartir… calls navigator.share when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setShare(share);
    stub(<SharePanel {...props} hasPin={false} />, "es");
    const nativeBtn = await screen.findByRole("button", {
      name: "Compartir…",
    });
    await act(async () => {
      fireEvent.click(nativeBtn);
    });
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Boda Ana", url: props.url }),
    );
  });
});
