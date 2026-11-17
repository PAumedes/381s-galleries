import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { en } from "../../app/i18n/en";
import { GalleryView } from "../../app/components/GalleryView";
import type { OpenGallery } from "../../app/components/types";

function stub(node: ReactNode) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "en", messages: en, studioName: "381 Studios" }),
      Component: () => <>{node}</>,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

const photos = [0, 1, 2].map((i) => ({
  id: `p${i}`,
  width: 3000,
  height: 2000,
  set: "A",
  variants: { web: true, ig: false },
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
  sets: [{ name: "A", count: 3 }],
  ...over,
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let tokenCalls = 0;
let tokenFirst: Response | null = null;
let known = false;
const clicks: { href: string; download: string }[] = [];

beforeEach(() => {
  tokenCalls = 0;
  tokenFirst = null;
  known = false;
  clicks.length = 0;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push({
      href: this.getAttribute("href") ?? "",
      download: this.download,
    });
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/favorites"))
        return json({
          visitor: known ? { email: "a@b.co", name: null } : null,
          favorites: [],
        });
      if (url.endsWith("/visitor")) {
        known = true;
        return json({ visitor: { email: "a@b.co", name: null } });
      }
      if (url.endsWith("/download-tokens")) {
        tokenCalls++;
        if (tokenFirst && tokenCalls === 1) return tokenFirst;
        const body = JSON.parse(String(init?.body));
        return json({
          tokens: body.photoIds.map((id: string) => ({
            photoId: id,
            url: `/dl/t-${id}`,
            filename: `${id}-${body.variant}.jpg`,
          })),
          missing: [],
          unavailable: [],
        });
      }
      return json({}, 404);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ready = () => screen.findByTestId("tile-0");
const tileDownload = (i: number) =>
  within(screen.getByTestId(`tile-${i}`)).getByRole("button", {
    name: "Download",
  });

describe("downloads in GalleryView", () => {
  it("opens the single sheet from a tile and downloads the chosen size", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await ready();
    await act(async () => {
      fireEvent.click(tileDownload(1));
    });
    const dlg = screen.getByRole("dialog", { name: "Download photo" });
    expect(within(dlg).queryByText("Instagram · 1080 px")).toBeNull();
    await act(async () => {
      fireEvent.click(within(dlg).getByText("Web · 1200 px"));
    });
    await waitFor(() =>
      expect(clicks).toEqual([{ href: "/dl/t-p1", download: "p1-web.jpg" }]),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the single sheet from the lightbox", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await ready();
    await act(async () => {
      fireEvent.click(screen.getByTestId("open-2"));
    });
    const lb = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(lb).getByRole("button", { name: "Download" }));
    });
    expect(screen.getByRole("dialog", { name: "Download photo" })).toBeTruthy();
  });

  it("opens the bulk sheet from the top bar when allowBulk", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await ready();
    const nav = screen.getAllByRole("navigation")[0];
    await act(async () => {
      fireEvent.click(within(nav).getByRole("button", { name: "Download" }));
    });
    expect(screen.getByRole("dialog", { name: "Download" })).toBeTruthy();
  });

  it("has no top-bar download button when bulk is off, but tiles still download", async () => {
    stub(
      <GalleryView gallery={gallery({ allowBulk: false })} photos={photos} />,
    );
    await ready();
    const nav = screen.getAllByRole("navigation")[0];
    expect(within(nav).queryByRole("button", { name: "Download" })).toBeNull();
    expect(tileDownload(0)).toBeTruthy();
  });

  it("hides every download control when no size is allowed", async () => {
    stub(
      <GalleryView
        gallery={gallery({
          allowHighres: false,
          allowWeb: false,
          allowIg: false,
        })}
        photos={photos}
      />,
    );
    await ready();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("opens the email gate when the server asks for an email, then resumes", async () => {
    known = true; // the page believes the visitor is known
    tokenFirst = json({ error: "email_required" }, 403);
    stub(
      <GalleryView gallery={gallery({ requireEmail: true })} photos={photos} />,
    );
    await ready();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await act(async () => {
      fireEvent.click(tileDownload(0));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("High resolution · 2048 px"));
    });
    const gate = await screen.findByRole("dialog", {
      name: "Enter your email to continue",
    });
    expect(clicks).toHaveLength(0);
    fireEvent.change(within(gate).getByPlaceholderText("Email"), {
      target: { value: "a@b.co" },
    });
    await act(async () => {
      fireEvent.submit(
        within(gate).getByPlaceholderText("Email").closest("form")!,
      );
    });
    await waitFor(() =>
      expect(clicks).toEqual([
        { href: "/dl/t-p0", download: "p0-highres.jpg" },
      ]),
    );
    expect(tokenCalls).toBe(2);
  });

  it("asks for the email first when one is required and unknown", async () => {
    stub(
      <GalleryView gallery={gallery({ requireEmail: true })} photos={photos} />,
    );
    await ready();
    await act(async () => {
      fireEvent.click(tileDownload(0));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Web · 1200 px"));
    });
    expect(
      await screen.findByRole("dialog", {
        name: "Enter your email to continue",
      }),
    ).toBeTruthy();
    expect(tokenCalls).toBe(0);
  });
});
