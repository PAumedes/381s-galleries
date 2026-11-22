import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddToHomeHint } from "../../app/components/AddToHomeHint";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";

const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IOS_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

let coarse = true;
let standalone = false;

function setUA(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}
function setNavStandalone(v: boolean | undefined) {
  Object.defineProperty(navigator, "standalone", {
    value: v,
    configurable: true,
  });
}

beforeEach(() => {
  coarse = true;
  standalone = false;
  localStorage.clear();
  setUA(ANDROID);
  setNavStandalone(undefined);
  window.matchMedia = ((q: string) => ({
    matches: q.includes("pointer: coarse")
      ? coarse
      : q.includes("display-mode: standalone")
        ? standalone
        : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => vi.restoreAllMocks());

/** `top` = distance of the grid from the viewport top. */
async function renderHint(
  opts: { slug?: string; top?: number; lang?: "es" | "en" } = {},
) {
  const lang = opts.lang ?? "en";
  const grid = document.createElement("main");
  grid.getBoundingClientRect = () =>
    ({ top: opts.top ?? 100, bottom: 5000, height: 5000 }) as DOMRect;
  document.body.appendChild(grid);
  const ref = { current: grid };
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({
        lang,
        messages: lang === "en" ? en : es,
        studioName: "S",
      }),
      Component: () => (
        <>
          <i>ready</i>
          <AddToHomeHint slug={opts.slug ?? "boda"} gridRef={ref} />
        </>
      ),
    },
  ]);
  const r = render(<Stub initialEntries={["/"]} />);
  await screen.findByText("ready");
  // findByText resolves on the commit; the hint's passive effects (the
  // beforeinstallprompt listener) may not have run yet. Flush them, or an
  // event fired right after would be missed (flaked on a loaded CI runner).
  await act(async () => {});
  return r;
}

const scrolled = () =>
  act(async () => void window.dispatchEvent(new Event("scroll")));
const prompt = () => {
  const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string }>;
  };
  e.prompt = vi.fn().mockResolvedValue(undefined);
  e.userChoice = Promise.resolve({ outcome: "accepted" });
  return e;
};
const fire = async (e: Event) => act(async () => void window.dispatchEvent(e));

describe("AddToHomeHint", () => {
  it("not shown before the visitor reaches the grid", async () => {
    await renderHint({ top: 900 });
    await fire(prompt());
    await scrolled();
    expect(
      screen.queryByRole("button", { name: "Add to Home Screen" }),
    ).toBeNull();
  });

  it("android/chrome: install button appears after scroll and triggers the captured prompt", async () => {
    await renderHint();
    const e = prompt();
    await fire(e);
    expect(e.defaultPrevented).toBe(true);
    await scrolled();
    const btn = await screen.findByRole("button", {
      name: "Add to Home Screen",
    });
    await act(async () => void fireEvent.click(btn));
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Add to Home Screen" }),
    ).toBeNull();
    expect(localStorage.getItem("a2hs:boda")).not.toBeNull();
  });

  it("android without beforeinstallprompt: nothing", async () => {
    await renderHint();
    await scrolled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ios safari: instructions with share icon, no install button", async () => {
    setUA(IOS_SAFARI);
    await renderHint();
    await scrolled();
    const note = await screen.findByRole("status");
    expect(note.textContent).toContain("Tap Share, then 'Add to Home Screen'");
    expect(note.querySelector("svg")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add to Home Screen" }),
    ).toBeNull();
  });

  it("ios text is localized (es)", async () => {
    setUA(IOS_SAFARI);
    await renderHint({ lang: "es" });
    await scrolled();
    expect((await screen.findByRole("status")).textContent).toContain(
      "Tocá Compartir y luego 'Agregar a inicio'",
    );
  });

  it("ios chrome / other browsers: nothing", async () => {
    setUA(IOS_CHROME);
    await renderHint();
    await scrolled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("desktop (fine pointer): nothing even with the install event", async () => {
    coarse = false;
    await renderHint();
    const e = prompt();
    await fire(e);
    await scrolled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(e.defaultPrevented).toBe(false);
  });

  it("already standalone (display-mode or navigator.standalone): nothing", async () => {
    standalone = true;
    setUA(IOS_SAFARI);
    const { unmount } = await renderHint();
    await scrolled();
    expect(screen.queryByRole("status")).toBeNull();
    unmount();
    standalone = false;
    setNavStandalone(true);
    await renderHint();
    await scrolled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("dismiss hides it and persists per gallery", async () => {
    setUA(IOS_SAFARI);
    const { unmount } = await renderHint({ slug: "boda" });
    await scrolled();
    await act(
      async () =>
        void fireEvent.click(
          await screen.findByRole("button", { name: "Close" }),
        ),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(localStorage.getItem("a2hs:boda")).not.toBeNull();
    unmount();
    await renderHint({ slug: "boda" });
    await scrolled();
    expect(screen.queryByRole("status")).toBeNull();
    unmount();
    await renderHint({ slug: "otra" });
    await scrolled();
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("localStorage failures are swallowed", async () => {
    setUA(IOS_SAFARI);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    await renderHint();
    await scrolled();
    const close = await screen.findByRole("button", { name: "Close" });
    await act(async () => void fireEvent.click(close));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shown immediately on mount when the grid is already in view", async () => {
    setUA(IOS_SAFARI);
    await renderHint({ top: 0 });
    expect(await screen.findByRole("status")).toBeTruthy();
  });
});

describe("T6.25 AddToHomeHint touch sizes", () => {
  const has = (el: Element, ...c: string[]) =>
    c.forEach((x) =>
      expect((el.getAttribute("class") ?? "").split(/\s+/)).toContain(x),
    );

  it("android: 15px message, 14px+ install button min-h-12, 48px dismiss with 24px icon, safe area kept", async () => {
    await renderHint();
    await fire(prompt());
    await scrolled();
    const btn = screen.getByRole("button", { name: "Add to Home Screen" });
    has(btn, "min-h-12", "text-sm", "uppercase");
    expect(btn.className).not.toContain("text-micro-label");
    const msg = screen.getByText(en["pwa.androidText"]);
    has(msg, "text-body");
    const bar = screen.getByRole("status");
    expect(bar.className).toContain("env(safe-area-inset-bottom)");
    const dismiss = screen.getByRole("button", { name: "Close" });
    has(dismiss, "size-12");
    has(dismiss.querySelector("svg")!, "size-6");
  });

  it("ios: 15px message", async () => {
    setUA(IOS_SAFARI);
    await renderHint({ lang: "es" });
    await scrolled();
    has(screen.getByText(es["pwa.ios"]), "text-body");
  });
});
