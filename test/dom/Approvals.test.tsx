import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryView } from "../../app/components/GalleryView";
import { Grid } from "../../app/components/Grid";
import { Lightbox } from "../../app/components/Lightbox";
import type { ApprovalsApi } from "../../app/components/use-approvals";
import type { GalleryPhoto, OpenGallery } from "../../app/components/types";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { makeT } from "../../app/i18n/t";
import { photos, t } from "./fixtures";

// T6.53f: approval button in the lightbox, badge in the grid, wiring in the page.
const base = photos(2);
const v2: GalleryPhoto = {
  ...base[0],
  id: "A",
  ver: 2,
  v: "t2",
  versions: [
    { n: 1, round: null, at: "2026-03-01T15:00:00.000Z", v: "t1" },
    { n: 2, round: 2, at: "2026-03-05T15:00:00.000Z", v: "t2" },
  ],
};
const single: GalleryPhoto = { ...base[1], id: "B" };

async function inRouter(node: React.ReactNode, messages = en, lang = "en") {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang, messages, studioName: "381 Studios" }),
      Component: () => node,
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

/** A stateful fake of the hook's API, so the button's text follows the clicks. */
function Harness({
  list,
  onToggle,
  startApproved = [],
  tr = t,
}: {
  tr?: typeof t;
  list: GalleryPhoto[];
  onToggle?: (p: GalleryPhoto) => void;
  startApproved?: string[];
}) {
  const [on, setOn] = useState(new Set(startApproved));
  const api: ApprovalsApi = {
    enabled: true,
    approvedAt: (p) => (on.has(p.id) ? (p.ver ?? 1) : null),
    toggle: async (p) => {
      onToggle?.(p);
      setOn((cur) => {
        const next = new Set(cur);
        if (!next.delete(p.id)) next.add(p.id);
        return next;
      });
    },
  };
  return (
    <Lightbox
      photos={list}
      index={0}
      t={tr}
      onClose={() => {}}
      onIndexChange={() => {}}
      approvals={api}
    />
  );
}

afterEach(cleanup);

describe("T6.53f lightbox approve button", () => {
  it("offers 'Approve vN' for the shown version, not pressed", async () => {
    await inRouter(<Harness list={[v2]} />);
    const b = await screen.findByRole("button", { name: "Approve v2" });
    expect(b.getAttribute("aria-pressed")).toBe("false");
  });

  it("a photo with no history is v1", async () => {
    await inRouter(<Harness list={[single]} />);
    expect(
      await screen.findByRole("button", { name: "Approve v1" }),
    ).toBeTruthy();
  });

  it("toggles to 'Approved in vN' (pressed), announces it, and back", async () => {
    const seen: string[] = [];
    await inRouter(<Harness list={[v2]} onToggle={(p) => seen.push(p.id)} />);
    const b = await screen.findByRole("button", { name: "Approve v2" });
    const live = screen.getByTestId("approve-live");
    expect(live.getAttribute("role")).toBe("status");
    expect(live.textContent).toBe("");
    fireEvent.click(b);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Approved in v2" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(seen).toEqual(["A"]);
    expect(live.textContent).toBe("Version 2 approved");
    fireEvent.click(screen.getByRole("button", { name: "Approved in v2" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve v2" })).toBeTruthy(),
    );
    expect(live.textContent).toBe("Approval of version 2 removed");
  });

  it("the click does not close the dialog or reach the swipe", async () => {
    const onClose = vi.fn();
    await inRouter(
      <Lightbox
        photos={[v2]}
        index={0}
        t={t}
        onClose={onClose}
        onIndexChange={() => {}}
        approvals={{
          enabled: true,
          approvedAt: () => null,
          toggle: async () => {},
        }}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Approve v2" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is absent without approvals, and when the album has them off", async () => {
    await inRouter(
      <Lightbox
        photos={[v2]}
        index={0}
        t={t}
        onClose={() => {}}
        onIndexChange={() => {}}
      />,
    );
    await screen.findByRole("dialog");
    expect(screen.queryByTestId("approve")).toBeNull();
    cleanup();
    await inRouter(
      <Lightbox
        photos={[v2]}
        index={0}
        t={t}
        onClose={() => {}}
        onIndexChange={() => {}}
        approvals={{
          enabled: false,
          approvedAt: () => null,
          toggle: async () => {},
        }}
      />,
    );
    await screen.findByRole("dialog");
    expect(screen.queryByTestId("approve")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Approv/);
  });

  it("speaks Spanish with typographic quotes only", async () => {
    await inRouter(
      <Harness list={[v2]} startApproved={["A"]} tr={makeT("es", es)} />,
      es,
      "es",
    );
    expect(
      await screen.findByRole("button", { name: "Aprobada en v2" }),
    ).toBeTruthy();
    for (const k of Object.keys(es).filter((k) => k.startsWith("approvals.")))
      expect((es as Record<string, string>)[k]).not.toMatch(/"/);
    for (const k of Object.keys(en).filter((k) => k.startsWith("approvals.")))
      expect((en as Record<string, string>)[k]).not.toMatch(/"/);
  });
});

describe("T6.53f grid badge", () => {
  const grid = (approvedAt?: (p: GalleryPhoto) => number | null) =>
    render(
      <Grid
        photos={[v2, single]}
        t={t}
        onOpen={() => {}}
        approvedAt={approvedAt}
      />,
    );

  it("only a photo approved at its shown version carries the badge", () => {
    grid((p) => (p.id === "A" ? 2 : null));
    const tile0 = screen.getByTestId("tile-0");
    expect(within(tile0).getByText("Approved in v2")).toBeTruthy();
    expect(screen.getAllByText(/Approved in/)).toHaveLength(1);
    expect(
      within(screen.getByTestId("tile-1")).queryByText(/Approved in/),
    ).toBeNull();
    expect(screen.getByTestId("approved-0").className).toContain(
      "pointer-events-none",
    );
  });

  it("an unversioned grid has no badge and no prop", () => {
    grid();
    expect(screen.queryByText(/Approved in/)).toBeNull();
  });
});

const gallery = (over: Partial<OpenGallery> = {}): OpenGallery => ({
  slug: "retoque",
  requireEmail: false,
  title: "Retoque",
  eventDate: null,
  coverPhotoId: "A",
  coverFocus: null,
  allowBulk: false,
  allowHighres: true,
  allowWeb: true,
  allowIg: false,
  mode: "delivery",
  palette: "claro",
  coverLayout: "completa",
  gridStyle: "filas",
  gridGap: "normal",
  sets: [{ name: "A", count: 2 }],
  ...over,
});

type Call = { url: string; method: string; body?: unknown };
let calls: Call[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url: String(input),
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (method === "GET")
        return new Response(
          JSON.stringify({
            visitor: null,
            favorites: [],
            approvals: [{ id: "A", ver: 2 }],
          }),
        );
      return new Response(JSON.stringify({ ok: true }));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function showPage(g: OpenGallery, list: GalleryPhoto[], preview = false) {
  await inRouter(<GalleryView gallery={g} photos={list} preview={preview} />);
  await screen.findByRole("heading", { name: "Retoque" });
}

describe("T6.53f page wiring", () => {
  it("the visitor's approvals from the favorites reply show as badge and pressed button", async () => {
    await showPage(gallery({ approvals: true }), [v2, single]);
    await waitFor(() =>
      expect(screen.getByTestId("approved-0").textContent).toBe(
        "Approved in v2",
      ),
    );
    expect(screen.queryByTestId("approved-1")).toBeNull();
    fireEvent.click(screen.getByTestId("tile-0").querySelector("button")!);
    expect(
      (
        await screen.findByRole("button", { name: "Approved in v2" })
      ).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("clicking un-approves with one POST of the shown version; the badge follows", async () => {
    await showPage(gallery({ approvals: true }), [v2, single]);
    await waitFor(() => screen.getByTestId("approved-0"));
    fireEvent.click(screen.getByTestId("tile-0").querySelector("button")!);
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Approved in v2" }),
      );
    });
    expect(calls.filter((c) => c.method === "POST")).toEqual([
      {
        url: "/api/g/retoque/approvals",
        method: "POST",
        body: { photoId: "A", version: 2, on: false },
      },
    ]);
    await waitFor(() => expect(screen.queryByTestId("approved-0")).toBeNull());
  });

  it("a refused approval reverts and shows the error toast", async () => {
    await showPage(gallery({ approvals: true }), [v2, single]);
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_u: unknown, init?: RequestInit) =>
        init?.method === "POST"
          ? new Response(JSON.stringify({ error: "x" }), { status: 500 })
          : new Response(
              JSON.stringify({ visitor: null, favorites: [], approvals: [] }),
            ),
    );
    fireEvent.click(screen.getByTestId("tile-1").querySelector("button")!);
    fireEvent.click(await screen.findByRole("button", { name: "Approve v1" }));
    expect(
      await screen.findByText("Couldn't save the approval. Please try again."),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Approve v1" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("an album without versioning: no button, no badge, no approvals request", async () => {
    await showPage(gallery(), [v2, single]);
    fireEvent.click(screen.getByTestId("tile-0").querySelector("button")!);
    await screen.findByRole("dialog");
    expect(screen.queryByTestId("approve")).toBeNull();
    expect(screen.queryByTestId("approved-0")).toBeNull();
    expect(calls.every((c) => !c.url.includes("approvals"))).toBe(true);
  });

  it("the admin preview approves in memory, with no request", async () => {
    await showPage(gallery({ approvals: true }), [v2, single], true);
    fireEvent.click(screen.getByTestId("tile-1").querySelector("button")!);
    fireEvent.click(await screen.findByRole("button", { name: "Approve v1" }));
    expect(
      await screen.findByRole("button", { name: "Approved in v1" }),
    ).toBeTruthy();
    expect(calls).toEqual([]);
  });
});
