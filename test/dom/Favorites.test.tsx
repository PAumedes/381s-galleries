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
import { es } from "../../app/i18n/es";
import { GalleryView } from "../../app/components/GalleryView";
import { EmailGate } from "../../app/components/EmailGate";
import type { OpenGallery } from "../../app/components/types";
import { t } from "./fixtures";

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

const photos = [0, 1, 2, 3].map((i) => ({
  id: `p${i}`,
  width: 3000,
  height: 2000,
  set: i < 2 ? "Ceremonia" : "Fiesta",
}));
const gallery = (over: Partial<OpenGallery> = {}): OpenGallery => ({
  slug: "boda",
  requireEmail: true,
  title: "Boda Ana",
  eventDate: null,
  coverPhotoId: "p0",
  allowBulk: true,
  sets: [
    { name: "Ceremonia", count: 2 },
    { name: "Fiesta", count: 2 },
  ],
  ...over,
});

type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];
let state: {
  visitor: { email: string; name: string | null } | null;
  favorites: string[];
  failFavorite: boolean;
  hold?: Promise<void>;
};

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  calls.length = 0;
  state = { visitor: null, favorites: [], failFavorite: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url.endsWith("/api/g/boda/favorites") && method === "GET")
        return jsonRes({ visitor: state.visitor, favorites: state.favorites });
      if (url.endsWith("/api/g/boda/visitor")) {
        state.visitor = { email: body.email, name: body.name ?? null };
        return jsonRes({ visitor: state.visitor });
      }
      if (url.endsWith("/api/g/boda/favorites") && method === "POST") {
        await state.hold;
        if (state.failFavorite) return jsonRes({ error: "x" }, 500);
        return jsonRes({ ok: true });
      }
      return jsonRes({}, 404);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const heart = (i: number, pressed = false) =>
  within(screen.getByTestId(`tile-${i}`)).getByRole("button", {
    name: pressed ? "Remove from favorites" : "Add to favorites",
  });
const posts = (suffix: string) =>
  calls.filter((c) => c.method === "POST" && c.url.endsWith(suffix));

describe("favorites in GalleryView", () => {
  it("loads favorites on mount and reflects them on the hearts", async () => {
    state.favorites = ["p1"];
    state.visitor = { email: "a@b.co", name: null };
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await waitFor(() => expect(heart(1, true)).toBeTruthy());
    expect(heart(0).getAttribute("aria-pressed")).toBe("false");
    expect(calls[0]).toMatchObject({ method: "GET" });
    expect(calls[0].url).toContain("/api/g/boda/favorites");
  });

  it("toggles optimistically (before the server answers) and POSTs once", async () => {
    let release!: () => void;
    state.hold = new Promise((r) => (release = r));
    state.visitor = { email: "a@b.co", name: null };
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await act(async () => {
      fireEvent.click(heart(0));
    });
    expect(heart(0, true).getAttribute("aria-pressed")).toBe("true");
    await act(async () => release());
    expect(posts("/favorites")).toHaveLength(1);
    expect(posts("/favorites")[0].body).toEqual({ photoId: "p0", on: true });
    expect(heart(0, true)).toBeTruthy();
    await act(async () => {
      fireEvent.click(heart(0, true));
    });
    expect(posts("/favorites")[1].body).toEqual({ photoId: "p0", on: false });
  });

  it("rolls back and shows a quiet toast when the server fails", async () => {
    state.visitor = { email: "a@b.co", name: null };
    state.failFavorite = true;
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await act(async () => {
      fireEvent.click(heart(0));
    });
    await waitFor(() =>
      expect(heart(0).getAttribute("aria-pressed")).toBe("false"),
    );
    expect(screen.getByRole("status").textContent).toBe(en["favorites.error"]);
  });

  it("rolls back when the network throws", async () => {
    state.visitor = { email: "a@b.co", name: null };
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("net"));
    await act(async () => {
      fireEvent.click(heart(2));
    });
    await waitFor(() =>
      expect(heart(2).getAttribute("aria-pressed")).toBe("false"),
    );
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("opens the email gate when required and no visitor, then completes the pending favorite", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await act(async () => {
      fireEvent.click(heart(3));
    });
    const dialog = await screen.findByRole("dialog", {
      name: en["gate.title"],
    });
    expect(within(dialog).getByText(en["gate.reason"])).toBeTruthy();
    expect(posts("/favorites")).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(en["gate.placeholder"]), {
      target: { value: "Ana@Example.com" },
    });
    fireEvent.change(within(dialog).getByLabelText(en["gate.name"]), {
      target: { value: "Ana" },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posts("/visitor")[0].body).toEqual({
      email: "Ana@Example.com",
      name: "Ana",
    });
    expect(posts("/favorites")[0].body).toEqual({ photoId: "p3", on: true });
    expect(heart(3, true)).toBeTruthy();
    // next favorite goes straight through
    await act(async () => {
      fireEvent.click(heart(0));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posts("/favorites")).toHaveLength(2);
  });

  it("does not open the gate when a visitor already exists or email is not required", async () => {
    state.visitor = { email: "a@b.co", name: null };
    const { unmount } = stub(
      <GalleryView gallery={gallery()} photos={photos} />,
    );
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await act(async () => {
      fireEvent.click(heart(0));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    state.visitor = null;
    stub(
      <GalleryView
        gallery={gallery({ requireEmail: false })}
        photos={photos}
      />,
    );
    await waitFor(() => expect(heart(1)).toBeTruthy());
    await act(async () => {
      fireEvent.click(heart(1));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape closes the gate without favoriting", async () => {
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await act(async () => {
      fireEvent.click(heart(0));
    });
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posts("/favorites")).toHaveLength(0);
    expect(heart(0).getAttribute("aria-pressed")).toBe("false");
  });

  it("favorites filter: count tab, only favorited photos, empty state", async () => {
    state.visitor = { email: "a@b.co", name: null };
    state.favorites = ["p1", "p3"];
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    const tab = await screen.findByRole("button", { name: /Favorites\s*2/ });
    fireEvent.click(tab);
    expect(screen.getAllByRole("button", { name: /^Photo \d+/ })).toHaveLength(
      2,
    );
    expect(document.querySelector('img[src="/img/p1/thumb"]')).toBeTruthy();
    expect(document.querySelector('img[src="/img/p0/thumb"]')).toBeNull();
    // un-favoriting there removes it from the filtered grid
    await act(async () => {
      fireEvent.click(heart(0, true));
    });
    expect(screen.getAllByRole("button", { name: /^Photo \d+/ })).toHaveLength(
      1,
    );
  });

  it("top-bar heart opens the favorites filter; empty state is shown", async () => {
    state.visitor = { email: "a@b.co", name: null };
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const topHeart = screen.getByRole("button", {
      name: en["favorites.title"],
    });
    fireEvent.click(topHeart);
    expect(screen.getByText(en["favorites.empty"])).toBeTruthy();
    expect(
      screen.queryAllByRole("button", { name: /^Photo \d+/ }),
    ).toHaveLength(0);
    expect(topHeart.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(topHeart); // toggles back
    expect(screen.getAllByRole("button", { name: /^Photo \d+/ })).toHaveLength(
      4,
    );
  });

  it("lightbox heart toggles too", async () => {
    state.visitor = { email: "a@b.co", name: null };
    stub(<GalleryView gallery={gallery()} photos={photos} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: /^Photo \d+/ })[0]);
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Add to favorites" }),
      );
    });
    expect(
      within(dialog)
        .getByRole("button", { name: "Remove from favorites" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(posts("/favorites")[0].body).toEqual({ photoId: "p0", on: true });
  });
});

describe("EmailGate", () => {
  const setup = (onSubmit = vi.fn(async () => "ok" as const)) => {
    const onClose = vi.fn();
    render(<EmailGate t={t} onSubmit={onSubmit} onClose={onClose} />);
    return { onSubmit, onClose };
  };

  it("is a modal dialog, focuses the email field and traps Tab", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const email = screen.getByLabelText(en["gate.placeholder"]);
    expect(document.activeElement).toBe(email);
    const close = screen.getByRole("button", { name: "Close" });
    const submit = screen.getByRole("button", { name: "Continue" });
    submit.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(submit);
  });

  it("shows an invalid message and does not submit a bad email", async () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByLabelText(en["gate.placeholder"]), {
      target: { value: "nope" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(en["gate.invalid"]);
  });

  it("shows a generic error when the submit fails and stays open", async () => {
    const { onClose } = setup(vi.fn(async () => "error" as const));
    fireEvent.change(screen.getByLabelText(en["gate.placeholder"]), {
      target: { value: "a@b.co" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(screen.getByRole("alert").textContent).toBe(en["gate.error"]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("has Spanish copy", () => {
    expect(es["gate.reason"]).toBe("Para guardar tus favoritas");
    expect(en["gate.reason"]).toBe("To save your favorites");
  });
});
