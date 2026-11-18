import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, Outlet } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { AdminShell } from "../../app/components/admin/AdminShell";
import {
  ActivityView,
  type ActivityViewData,
} from "../../app/components/admin/ActivityView";
import {
  FavoritesView,
  type FavoritesViewData,
} from "../../app/components/admin/FavoritesView";
import {
  GalleryEditView,
  type GalleryEditData,
} from "../../app/components/admin/GalleryEditView";
import { GalleryList } from "../../app/components/admin/GalleryList";
import { SetupView } from "../../app/components/admin/SetupView";
import { allMessages } from "../../app/i18n/dictionaries";
import { getAdminLang } from "../../app/i18n/lang";

const status = {
  mock: false,
  connected: true,
  lastSyncAt: "2026-11-16T13:05:09Z",
  lastError: null,
};

function clearCookie() {
  const past = "Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  document.cookie = `admin_lang=; Max-Age=0; ${past}; Path=/`;
  document.cookie = `admin_lang=; Max-Age=0; ${past}; Path=/admin`;
}

/** Root route whose loader mirrors app/root.tsx: language from the admin cookie. */
function app(children: ReactNode, path = "/admin") {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => {
        // Same parser the server uses (first valid value wins).
        // (happy-dom's Request drops the forbidden `cookie` header, so pass a
        // minimal stand-in.)
        const lang = getAdminLang({
          headers: new Map([["cookie", document.cookie]]),
        } as unknown as Request);
        return { lang, messages: allMessages(lang), studioName: "Estudio" };
      },
      Component: () => <Outlet />,
      children: [{ path: "admin/*", Component: () => <>{children}</> }],
    },
  ]);
  return render(<Stub initialEntries={[path]} />);
}

beforeEach(() => {
  // Path=/admin cookies are only visible from /admin pages.
  (
    window as unknown as { happyDOM: { setURL(u: string): void } }
  ).happyDOM.setURL("http://localhost:3000/admin");
  clearCookie();
});
afterEach(clearCookie);

describe("admin language toggle", () => {
  const shell = () =>
    app(
      <AdminShell status={status}>
        <p>content</p>
      </AdminShell>,
    );

  it("defaults to Spanish with ES pressed", async () => {
    shell();
    expect(await screen.findByRole("link", { name: "Galerías" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ajustes" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "ES" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "EN" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(document.body.textContent).toContain("Google conectado");
    expect(document.body.textContent).toContain("16/11/2026 10:05");
  });

  it("switches to English, sets the cookie, and switches back", async () => {
    const user = userEvent.setup();
    shell();
    await user.click(await screen.findByRole("button", { name: "EN" }));
    expect(await screen.findByRole("link", { name: "Galleries" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(document.cookie).toContain("admin_lang=en");
    expect(document.body.textContent).toContain("Google connected");
    expect(document.body.textContent).toContain("Nov 16, 2026");
    expect(document.body.textContent).not.toContain("Ajustes");
    expect(
      screen.getByRole("button", { name: "EN" }).getAttribute("aria-pressed"),
    ).toBe("true");

    await user.click(screen.getByRole("button", { name: "ES" }));
    expect(await screen.findByRole("link", { name: "Ajustes" })).toBeTruthy();
    expect(document.cookie).toContain("admin_lang=es");
  });

  it("an invalid cookie value renders Spanish", async () => {
    document.cookie = "admin_lang=klingon; Path=/";
    shell();
    expect(await screen.findByRole("link", { name: "Ajustes" })).toBeTruthy();
  });

  it("starts in English when the cookie says so (no toggle needed)", async () => {
    document.cookie = "admin_lang=en; Path=/";
    shell();
    expect(await screen.findByRole("link", { name: "Settings" })).toBeTruthy();
  });
});

const galleryBase: GalleryEditData = {
  gallery: {
    id: "g1",
    title: "Boda Ana",
    slug: "boda-ana",
    clientName: null,
    eventDate: "2026-11-01",
    expires: null,
    status: "draft",
    allowHighres: true,
    allowWeb: true,
    allowIg: false,
    allowBulk: true,
    requireEmail: true,
    mode: "proofing",
    palette: "claro",
    coverLayout: "completa",
    gridStyle: "filas",
    gridGap: "normal",
    hasPin: false,
    showOnHome: false,
    coverPhotoId: "p1",
    coverFocus: null,
  },
  hasWmFiles: false,
  hasThumbWmFiles: false,
  photos: [{ id: "p1", set: "Highlights", name: "IMG_1", takenAt: null }],
  version: "v1",
  issues: {
    groups: [
      {
        type: "missing_web",
        label: "Falta la versión web",
        items: [{ set: "Fiesta", name: "IMG_9" }],
      },
    ],
    truncated: 2,
    total: 3,
  },
} as unknown as GalleryEditData;

describe("admin screens in English", () => {
  beforeEach(() => {
    document.cookie = "admin_lang=en; Path=/";
  });

  it("gallery editor: sections, mode names Proof/Delivery, stored values unchanged", async () => {
    const at = (tab: string) => {
      cleanup();
      return app(
        <GalleryEditView data={galleryBase} actionData={undefined} />,
        `/admin/g/g1${tab}`,
      );
    };
    at("");
    expect(
      await screen.findByRole("heading", { name: "Details" }),
    ).toBeTruthy();
    for (const h of ["Status", "Access PIN", "Public home", "Options"])
      expect(screen.getByRole("heading", { name: h }), h).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: /./ });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual([
      "Details",
      "Photos",
      "Cover",
      "Design",
      "Share",
      "Activity",
      "Favorites",
    ]);
    const proof = screen.getByLabelText("Proof") as HTMLInputElement;
    const delivery = screen.getByLabelText("Delivery") as HTMLInputElement;
    expect(proof.value).toBe("proofing");
    expect(delivery.value).toBe("delivery");
    expect(proof.checked).toBe(true);
    expect(screen.queryByText("Prueba")).toBeNull();
    expect(screen.queryByText("Entrega")).toBeNull();
    expect(screen.getByRole("button", { name: "Save details" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "How it looks" })).toBeTruthy();

    at("?tab=fotos");
    expect(await screen.findByRole("heading", { name: "Photos" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sync notices" })).toBeTruthy();
    expect(screen.getByText("Missing web version (1)")).toBeTruthy();
    expect(screen.getByText("…and 2 more notices.")).toBeTruthy();

    at("?tab=diseno");
    expect(await screen.findByRole("heading", { name: "Design" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();

    at("?tab=portada");
    expect(
      await screen.findByRole("heading", { name: "1. Pick the focal point" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "2. How it looks" }),
    ).toBeTruthy();

    at("?tab=compartir");
    expect(await screen.findByRole("heading", { name: "Share" })).toBeTruthy();
  });

  it("server errors arrive already translated and are shown as-is", async () => {
    app(
      <GalleryEditView
        data={galleryBase}
        actionData={{
          intent: "pin",
          ok: false,
          error: "Check the PIN.",
          fieldErrors: { pin: "x" },
        }}
      />,
      "/admin/g/g1",
    );
    expect(await screen.findByText("Check the PIN.")).toBeTruthy();
  });

  it("gallery list: filters, headers, status, dates, empty states", async () => {
    app(
      <GalleryList
        galleries={[
          {
            id: "g1",
            title: "Boda",
            slug: "boda",
            clientName: null,
            eventDate: "2026-11-01",
            status: "published",
            expiresAt: null,
            expired: false,
            coverPhotoId: null,
            photoCount: 1200,
            views: 3,
            downloads: 2,
            issueCount: 1,
          },
        ]}
        filter="todas"
        total={1}
      />,
    );
    expect((await screen.findAllByText("Published")).length).toBe(2); // tab + status
    expect(screen.getByRole("link", { name: "Drafts" })).toBeTruthy();
    expect(screen.getByText("Nov 1, 2026")).toBeTruthy();
    expect(screen.getByText("No expiry")).toBeTruthy();
    expect(screen.getByText("1,200")).toBeTruthy();
    expect(screen.getByLabelText("1 sync notice")).toBeTruthy();
    expect(
      screen.getByPlaceholderText("Search by title, slug or client"),
    ).toBeTruthy();
  });

  it("gallery list empty library", async () => {
    app(<GalleryList galleries={[]} filter="todas" total={0} />);
    expect(await screen.findByText("No galleries yet")).toBeTruthy();
  });

  it("setup page", async () => {
    app(
      <SetupView
        data={{
          connected: true,
          mock: false,
          rootName: "Mi Carpeta",
          studioName: "Estudio",
          lastSyncAt: "2026-11-16T13:05:09Z",
          cacheWarm: { warmed: 1500, total: 2000 },
          lastError: null,
        }}
        actionData={undefined}
      />,
      "/admin/setup",
    );
    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeTruthy();
    expect(screen.getByTestId("cache-warm").textContent).toBe(
      "Cached photos: 1,500 / 2,000",
    );
  });

  it("activity and favorites", async () => {
    const activity: ActivityViewData = {
      gallery: { id: "g1", title: "Boda", slug: "boda" },
      summary: { views: 1, visitors: 1, photos: 1, bulks: 1 },
      rows: [
        {
          id: "h1",
          createdAt: "2026-11-16T02:30:00Z",
          email: null,
          variant: "highres",
          country: "AR",
          photoId: null,
          name: null,
          set: null,
          bulk: { scope: "set:Fiesta", count: 1, children: [] },
        },
      ],
      next: null,
      filters: { visitor: "", size: "" },
      visitorOptions: [],
      views: [],
    } as unknown as ActivityViewData;
    app(<ActivityView data={activity} />, "/admin/g/g1/activity");
    expect(await screen.findByText("Photos downloaded")).toBeTruthy();
    expect(
      screen.getByText("Full download: Section Fiesta (1 photo)"),
    ).toBeTruthy();
    expect(screen.getByText("Anonymous")).toBeTruthy();
    expect(screen.getByText("No visits yet.")).toBeTruthy();
  });

  it("favorites: anonymous label is built client-side", async () => {
    const fav: FavoritesViewData = {
      gallery: { id: "g1", title: "Boda", slug: "boda" },
      visitors: [
        {
          id: "abc123-0000",
          label: "Anónimo #abc123",
          anon: true,
          lists: [
            {
              name: "Favoritos",
              count: 1,
              last: "2026-11-16T02:30:00Z",
              photos: [{ id: "p1", name: "IMG_1", set: "x", hidden: false }],
            },
          ],
        },
      ],
      all: [{ id: "p1", name: "IMG_1", set: "x", hidden: false, picks: 1 }],
    } as unknown as FavoritesViewData;
    app(<FavoritesView data={fav} />, "/admin/g/g1/favorites");
    expect(await screen.findByText("Anonymous #abc123")).toBeTruthy();
    expect(screen.getByText("All favorites")).toBeTruthy();
    expect(within(document.body).getByText("1 visitor")).toBeTruthy();
  });
});
