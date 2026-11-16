import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { GalleryView } from "../../app/components/GalleryView";
import { PinScreen } from "../../app/components/PinScreen";
import { UnavailableScreen } from "../../app/components/UnavailableScreen";
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

const mk = (n: number, set: string, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${set}${from + i}`,
    width: 3000,
    height: 2000,
    set,
  }));

const gallery = (over: Partial<OpenGallery> = {}): OpenGallery => ({
  title: "Boda Ana",
  eventDate: "2026-03-14",
  clientName: null,
  coverPhotoId: "Cer0",
  allowBulk: true,
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

afterEach(() => vi.restoreAllMocks());

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

  it("set tabs: All first and default; selecting a set filters the grid", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "All",
      "Ceremonia",
      "Fiesta",
    ]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    const tiles = () => screen.getAllByRole("button", { name: /^Photo \d+/ });
    expect(tiles()).toHaveLength(5);
    fireEvent.click(tabs[2]);
    expect(tiles()).toHaveLength(2);
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
  });

  it("a single set shows no tabs", async () => {
    stub(
      <GalleryView
        gallery={gallery({ sets: [{ name: "Highlights", count: 2 }] })}
        photos={mk(2, "H").map((p) => ({ ...p, set: "Highlights" }))}
      />,
    );
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("clicking a tile opens the lightbox on the filtered list; close unmounts it", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    const tabs = await screen.findAllByRole("tab");
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
    expect(writeText).toHaveBeenCalledTimes(1);
    const url = new URL(writeText.mock.calls[0][0] as string);
    expect(url.search).toBe("");
    expect(screen.getByRole("status").textContent).toBe("Link copied");
  });
});
