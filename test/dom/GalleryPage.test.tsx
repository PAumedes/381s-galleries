import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { GalleryView } from "../../app/components/GalleryView";
import { PinScreen } from "../../app/components/PinScreen";
import { UnavailableScreen } from "../../app/components/UnavailableScreen";
import type { OpenGallery } from "../../app/components/types";

function stub(
  node: ReactNode,
  lang: "en" | "es" = "en",
  studioName = "381 Studios",
) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang,
        messages: lang === "en" ? en : es,
        studioName,
      }),
      Component: () => <>{node}</>,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

/** Set tabs are plain buttons in a "Sections" nav (no tab roles). */
const findTabs = async () =>
  within(
    await screen.findByRole("navigation", { name: "Sections" }),
  ).getAllByRole("button");
const mk = (n: number, set: string, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${set}${from + i}`,
    width: 3000,
    height: 2000,
    set,
  }));

const gallery = (over: Partial<OpenGallery> = {}): OpenGallery => ({
  slug: "boda",
  requireEmail: true,
  title: "Boda Ana",
  eventDate: "2026-03-14",
  coverPhotoId: "Cer0",
  allowBulk: true,
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
const photos = [...mk(3, "Cer"), ...mk(2, "Fie")].map((p) => ({
  ...p,
  set: p.id.startsWith("Cer") ? "Ceremonia" : "Fiesta",
}));

beforeEach(() => {
  // GalleryView loads favourites on mount; keep the network out of these tests.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ visitor: null, favorites: [] })),
    ),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PinScreen", () => {
  it("renders title, a non-autofilled password field, submit, and error", async () => {
    stub(<PinScreen title="Boda Ana" error="Wrong PIN" />);
    expect(
      await screen.findByRole("heading", { name: "Boda Ana" }),
    ).toBeTruthy();
    const input = screen.getByPlaceholderText("PIN") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.name).toBe("pin");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(screen.getByRole("button", { name: "Enter" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Wrong PIN");
    expect(document.querySelector("form")?.method).toBe("post");
  });
  it("shows no alert without an error", async () => {
    stub(<PinScreen title="Boda Ana" />);
    await screen.findByRole("heading");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("UnavailableScreen", () => {
  it("shows the generic translated message", async () => {
    stub(<UnavailableScreen />, "es");
    expect(await screen.findByText(es["unavailable.title"])).toBeTruthy();
    expect(screen.getByText(es["unavailable.message"])).toBeTruthy();
  });
});

describe("gallery theme", () => {
  const logos = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-logo=wordmark]"),
    ).map((i) => (/text-white/.test(i.className) ? "white" : "black"));

  it("dark: data-theme on the root and the light logo in the top bar", async () => {
    stub(
      <GalleryView gallery={gallery({ palette: "oscuro" })} photos={photos} />,
    );
    await screen.findByRole("heading", { level: 1, name: "Boda Ana" });
    expect(document.querySelector('[data-theme="oscuro"]')).toBeTruthy();
    expect(logos().every((s) => s === "white")).toBe(true);
    // cover is unchanged
    expect(document.querySelector('img[src="/img/Cer0/view-lg"]')).toBeTruthy();
  });

  it("T6.22: the top-bar wordmark is hidden on phones and clipped in its grid column", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await screen.findByRole("heading", { level: 1, name: "Boda Ana" });
    const bar = document.querySelector("nav [data-logo=wordmark]")!;
    const cls = bar.className.split(/\s+/);
    expect(cls).toEqual(
      expect.arrayContaining([
        "hidden",
        "sm:block",
        "min-w-0",
        "overflow-hidden",
      ]),
    );
    expect(cls).not.toContain("inline-flex");
  });

  it("claro: data-theme claro and the black logo in the top bar", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await screen.findByRole("heading", { level: 1, name: "Boda Ana" });
    expect(document.querySelector('[data-theme="claro"]')).toBeTruthy();
    expect(document.querySelector("[data-page]")).toBeTruthy();
    expect(logos()).toContain("black");
  });

  it("PIN and unavailable screens follow the theme when known", async () => {
    stub(<PinScreen title="Boda" palette="oscuro" />);
    await screen.findByRole("heading", { name: "Boda" });
    expect(
      document.querySelector('[data-theme="oscuro"][data-page]'),
    ).toBeTruthy();
    expect(logos()).toEqual(["white"]);
  });

  it("PIN screen follows Arena / Gris and defaults to claro", async () => {
    stub(<PinScreen title="Boda" palette="arena" />);
    await screen.findByRole("heading", { name: "Boda" });
    expect(
      document.querySelector('[data-theme="arena"][data-page]'),
    ).toBeTruthy();
    cleanup();
    stub(<PinScreen title="Boda" />);
    await screen.findByRole("heading", { name: "Boda" });
    expect(document.querySelector('[data-theme="claro"]')).toBeTruthy();
    expect(logos()).toEqual(["black"]);
  });
});

describe("GalleryView", () => {
  it("hero uses the cover view-lg image and shows title and localized date", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await screen.findByRole("heading", { level: 1, name: "Boda Ana" });
    const hero = document.querySelector('img[src="/img/Cer0/view-lg"]');
    expect(hero).toBeTruthy();
    expect(screen.getByText(/March 14, 2026/)).toBeTruthy();
    expect(screen.getByText(/© \d{4} 381 Studios/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "View gallery" })).toBeTruthy();
  });

  it("uses the studio name from the root loader in hero and footer", async () => {
    stub(
      <GalleryView gallery={gallery()} photos={photos} />,
      "en",
      "Foo Studio",
    );
    await screen.findByRole("heading", { level: 1, name: "Boda Ana" });
    expect(screen.getByText(/© \d{4} Foo Studio/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("381 Studios");
  });

  it("renders a downloadSlot in the top bar only when provided", async () => {
    const { unmount } = stub(
      <GalleryView gallery={gallery()} photos={photos} />,
    );
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByTestId("dl-slot")).toBeNull();
    unmount();
    stub(
      <GalleryView
        gallery={gallery()}
        photos={photos}
        downloadSlot={<button data-testid="dl-slot">dl</button>}
      />,
    );
    const slot = await screen.findByTestId("dl-slot");
    expect(slot.closest("nav")).toBeTruthy();
  });

  it("set tabs: All first and default; selecting a set filters the grid", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    const tabs = await findTabs();
    expect(tabs.map((t) => t.textContent)).toEqual([
      "All",
      "Ceremonia",
      "Fiesta",
    ]);
    expect(tabs[0].getAttribute("aria-current")).toBe("true");
    const tiles = () => screen.getAllByRole("button", { name: /^Photo \d+/ });
    expect(tiles()).toHaveLength(5);
    fireEvent.click(tabs[2]);
    expect(tiles()).toHaveLength(2);
    expect(tabs[2].getAttribute("aria-current")).toBe("true");
    expect(tabs[0].getAttribute("aria-current")).toBeNull();
  });

  it("a single set shows no tabs", async () => {
    stub(
      <GalleryView
        gallery={gallery({ sets: [{ name: "Highlights", count: 2 }] })}
        photos={mk(2, "H").map((p) => ({ ...p, set: "Highlights" }))}
      />,
    );
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
  });

  it("clicking a tile opens the lightbox on the filtered list; close unmounts it", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    const tabs = await findTabs();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(tabs[2]);
    fireEvent.click(screen.getAllByRole("button", { name: /^Photo \d+/ })[1]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("2 / 2")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("share copies the link without ?lang and shows a toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    const btn = await screen.findByRole("button", { name: "Share" });
    await act(async () => {
      fireEvent.click(btn);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const url = new URL(writeText.mock.calls[0][0] as string);
    expect(url.search).toBe("");
    expect(screen.getByRole("status").textContent).toBe("Link copied");
  });
});
