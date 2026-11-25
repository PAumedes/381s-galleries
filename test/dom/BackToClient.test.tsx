import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { GalleryRoutePage } from "../../app/components/GalleryRoutePage";
import { GalleryView } from "../../app/components/GalleryView";
import type { OpenGallery } from "../../app/components/types";
import type { GalleryRouteData } from "../../app/lib/server/gallery-route";

// T6.50: the quiet "back to the client page" link in an opened album.
function stub(
  node: () => ReactNode,
  lang: "en" | "es" = "en",
  path = "/acme/boda",
) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang,
        messages: lang === "en" ? en : es,
        studioName: "381 Studios",
      }),
      Component: () => <>{node()}</>,
    },
  ]);
  void path;
  return Stub;
}
const gallery: OpenGallery = {
  slug: "boda",
  requireEmail: true,
  title: "Boda Ana",
  eventDate: null,
  coverPhotoId: null,
  allowBulk: true,
  palette: "claro",
  coverLayout: "completa",
  gridStyle: "filas",
  gridGap: "normal",
  sets: [],
};
const link = { name: "ACME Corp", href: "/acme?pagina=2" };
const open = (over: Partial<GalleryRouteData> = {}) =>
  ({
    state: "open",
    gallery,
    photos: [],
    origin: "https://x.test",
    ...over,
  }) as unknown as GalleryRouteData;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ visitor: null, favorites: [] })),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("T6.50 BackToClient link", () => {
  it("renders a link to the client page with a localized label (EN)", async () => {
    const Stub = stub(() => (
      <GalleryView gallery={gallery} photos={[]} backToClient={link} />
    ));
    render(<Stub initialEntries={["/"]} />);
    const a = (await screen.findByRole("link", {
      name: "Back to ACME Corp",
    })) as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("/acme?pagina=2");
    expect(a.textContent).toContain("ACME Corp");
  });

  it("is Spanish in ES", async () => {
    const Stub = stub(
      () => <GalleryView gallery={gallery} photos={[]} backToClient={link} />,
      "es",
    );
    render(<Stub initialEntries={["/"]} />);
    expect(
      await screen.findByRole("link", { name: "Volver a ACME Corp" }),
    ).toBeTruthy();
  });

  it("is not rendered without the prop", async () => {
    const Stub = stub(() => <GalleryView gallery={gallery} photos={[]} />);
    render(<Stub initialEntries={["/"]} />);
    await screen.findByRole("heading", { name: "Boda Ana" });
    expect(
      screen.queryByRole("link", { name: /ACME|Back to|Volver a/ }),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("ACME");
  });

  it("is not rendered in the admin preview", async () => {
    const Stub = stub(() => (
      <GalleryView gallery={gallery} photos={[]} backToClient={link} preview />
    ));
    render(<Stub initialEntries={["/"]} />);
    await screen.findByRole("heading", { name: "Boda Ana" });
    expect(document.body.textContent).not.toContain("ACME");
  });

  it("uses logical (RTL-safe) classes, a 48px target, a truncating label and a mirrored chevron", async () => {
    const Stub = stub(() => (
      <GalleryView gallery={gallery} photos={[]} backToClient={link} />
    ));
    render(<Stub initialEntries={["/"]} />);
    const a = await screen.findByRole("link", { name: "Back to ACME Corp" });
    expect(a.className).toContain("min-h-12");
    expect(a.className).not.toMatch(
      /(^|\s)(ml|mr|pl|pr|left|right)-|text-left|text-right/,
    );
    expect(a.querySelector(".truncate")).toBeTruthy();
    expect(a.querySelector("svg")?.getAttribute("class")).toContain("rtl:");
  });
});

describe("T6.50 GalleryRoutePage", () => {
  it("shows it for an open album and never on the PIN gate", async () => {
    const Stub = stub(() => (
      <GalleryRoutePage
        loaderData={
          {
            state: "locked",
            slug: "boda",
            title: "Boda Ana",
            palette: "claro",
            origin: "https://x.test",
            backToClient: link,
          } as unknown as GalleryRouteData
        }
      />
    ));
    render(<Stub initialEntries={["/"]} />);
    await screen.findByRole("heading", { name: "Boda Ana" });
    expect(document.body.textContent).not.toContain("ACME");
  });

  /** Renders `first`, then `second` when the button is pressed (same mounted page). */
  function Swap({
    first,
    second,
  }: {
    first: GalleryRouteData;
    second: GalleryRouteData;
  }) {
    const [n, setN] = useState(0);
    return (
      <>
        <button onClick={() => setN(1)}>swap</button>
        <GalleryRoutePage loaderData={n ? second : first} />
      </>
    );
  }

  it("keeps the link when a revalidation of the same album arrives without a Referer", async () => {
    const Stub = stub(() => (
      <Swap first={open({ backToClient: link })} second={open()} />
    ));
    render(<Stub initialEntries={["/"]} />);
    await screen.findByRole("link", { name: "Back to ACME Corp" });
    fireEvent.click(screen.getByText("swap"));
    expect(
      screen.getByRole("link", { name: "Back to ACME Corp" }),
    ).toBeTruthy();
  });

  it("does not carry the link over to another album", async () => {
    const Stub = stub(() => (
      <Swap
        first={open({ backToClient: link })}
        second={open({
          gallery: { ...gallery, slug: "otra", title: "Otra" },
        } as never)}
      />
    ));
    render(<Stub initialEntries={["/"]} />);
    await screen.findByRole("link", { name: "Back to ACME Corp" });
    fireEvent.click(screen.getByText("swap"));
    await screen.findByRole("heading", { name: "Otra" });
    expect(screen.queryByRole("link", { name: /ACME/ })).toBeNull();
  });

  it("keeps it from the PIN gate (hidden there) to the opened album after the unlock", async () => {
    const locked = {
      state: "locked",
      slug: "boda",
      title: "Boda Ana",
      palette: "claro",
      origin: "https://x.test",
      backToClient: link,
    } as unknown as GalleryRouteData;
    const Stub = stub(() => <Swap first={locked} second={open()} />);
    render(<Stub initialEntries={["/"]} />);
    await screen.findByRole("heading", { name: "Boda Ana" });
    expect(screen.queryByRole("link", { name: /ACME/ })).toBeNull();
    fireEvent.click(screen.getByText("swap"));
    expect(
      await screen.findByRole("link", { name: "Back to ACME Corp" }),
    ).toBeTruthy();
  });

  it("keeps it only while the same client returns (T6.50 keyed kept link)", async () => {
    const Stub = stub(() => (
      <Swap
        first={open({ clientSlug: "acme", backToClient: link })}
        second={open({ clientSlug: "acme" })}
      />
    ));
    render(<Stub initialEntries={["/"]} />);
    await screen.findByRole("link", { name: "Back to ACME Corp" });
    fireEvent.click(screen.getByText("swap"));
    expect(
      screen.getByRole("link", { name: "Back to ACME Corp" }),
    ).toBeTruthy();
  });

  it.each([
    ["moved to another client", { clientSlug: "beta" }],
    ["unassigned", {}],
  ])("drops it when the same album is %s", async (_n, next) => {
    const Stub = stub(() => (
      <Swap
        first={open({ clientSlug: "acme", backToClient: link })}
        second={open(next)}
      />
    ));
    render(<Stub initialEntries={["/"]} />);
    await screen.findByRole("link", { name: "Back to ACME Corp" });
    fireEvent.click(screen.getByText("swap"));
    await screen.findByRole("heading", { name: "Boda Ana" });
    expect(screen.queryByRole("link", { name: /ACME/ })).toBeNull();
  });

  it.each(["Ünïcode 😀 ".repeat(30), "ארגון שם ארוך מאוד ".repeat(20)])(
    "a long emoji/RTL client name stays one truncated line",
    async (name) => {
      const Stub = stub(() => (
        <GalleryRoutePage
          loaderData={open({ backToClient: { name, href: "/a" } })}
        />
      ));
      render(<Stub initialEntries={["/"]} />);
      const a = (await screen.findByRole("link", {
        name: /^Back to /,
      })) as HTMLElement;
      expect(a.textContent).toBe(name);
      expect(a.querySelector("span")?.className).toContain("truncate");
    },
  );
});
