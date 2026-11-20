import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { Lightbox } from "../../app/components/Lightbox";
import { PreloadCache } from "../../app/components/lightbox/preload-cache";
import { imgUrl } from "../../app/components/types";
import { photos, t } from "./fixtures";

// Versioned URLs (`?v=`) are cacheable; only those count as ready.
const stable = photos(30).map((p) => ({ ...p, v: "1" }));

function Harness({ start = 3 }: { start?: number }) {
  const [i, setI] = useState(start);
  return (
    <Lightbox
      photos={stable}
      index={i}
      t={t}
      onClose={() => {}}
      onIndexChange={setI}
    />
  );
}

const cur = () => screen.getByTestId("lightbox-img") as HTMLImageElement;
const next = () =>
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
const prev = () =>
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
const visible = (el: Element) => el.className.includes("opacity-100");

class FakeImage {
  static made: FakeImage[] = [];
  static cancelled: FakeImage[] = [];
  sizes = "";
  srcset = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoded = 0;
  firstSrc = "";
  private _src = "";
  constructor() {
    FakeImage.made.push(this);
  }
  set src(v: string) {
    if (!v && this._src) FakeImage.cancelled.push(this);
    else if (v && !this.firstSrc) this.firstSrc = v;
    this._src = v;
  }
  get src() {
    return this._src;
  }
  removeAttribute() {}
  decode() {
    this.decoded++;
    return Promise.resolve();
  }
  finish() {
    this.onload?.();
  }
}
const preloaded = () => FakeImage.made.map((m) => m.firstSrc);
const byUrl = (url: string) => FakeImage.made.find((m) => m.firstSrc === url)!;
const live = () =>
  FakeImage.made.filter((m) => m.src && !FakeImage.cancelled.includes(m));

describe("T6.26 lightbox preload window", () => {
  const RealImage = globalThis.Image;
  beforeEach(() => {
    FakeImage.made = [];
    FakeImage.cancelled = [];
    globalThis.Image = FakeImage as unknown as typeof Image;
  });
  afterEach(() => {
    globalThis.Image = RealImage;
  });

  it("opening preloads next, previous, then two ahead", () => {
    render(<Harness start={3} />);
    expect(preloaded()).toEqual([
      "/img/p4/view-sm?v=1",
      "/img/p2/view-sm?v=1",
      "/img/p5/view-sm?v=1",
    ]);
  });

  it("going forward keeps the request for the photo still in the window", () => {
    render(<Harness start={3} />);
    const p5 = byUrl("/img/p5/view-sm?v=1");
    next();
    expect(FakeImage.cancelled).not.toContain(p5);
    expect(FakeImage.cancelled).toEqual([]);
    // p5 is not requested twice; only p6 (ahead) and p3 (behind) are new.
    expect(preloaded().filter((u) => u === "/img/p5/view-sm?v=1")).toHaveLength(
      1,
    );
    expect(preloaded().slice(3)).toEqual([
      "/img/p3/view-sm?v=1",
      "/img/p6/view-sm?v=1",
    ]);
  });

  it("going backward preloads two behind and one ahead", () => {
    render(<Harness start={10} />);
    prev();
    expect(preloaded().slice(3)).toEqual([
      "/img/p8/view-sm?v=1",
      "/img/p10/view-sm?v=1",
      "/img/p7/view-sm?v=1",
    ]);
  });

  it("never cancels a photo inside the window while navigating", () => {
    render(<Harness start={5} />);
    for (let k = 0; k < 6; k++) next();
    const windowUrls = [
      "/img/p10/view-sm?v=1",
      "/img/p11/view-sm?v=1",
      "/img/p12/view-sm?v=1",
      "/img/p13/view-sm?v=1",
    ];
    for (const u of windowUrls)
      expect(FakeImage.cancelled).not.toContain(byUrl(u));
  });

  it("holds at most 6 decoded neighbours; older ones are released", () => {
    render(<Harness start={0} />);
    for (let k = 0; k < 14; k++) next();
    expect(live().length).toBeLessThanOrEqual(6);
    expect(FakeImage.cancelled.length).toBeGreaterThan(0);
  });

  it("a finished preload that leaves the cache is not cancelled twice", () => {
    render(<Harness start={0} />);
    byUrl("/img/p1/view-sm?v=1").finish();
    for (let k = 0; k < 14; k++) next();
    expect(FakeImage.cancelled).not.toContain(byUrl("/img/p1/view-sm?v=1"));
  });

  it("decodes each preload when the browser supports it", () => {
    render(<Harness start={3} />);
    for (const m of FakeImage.made) expect(m.decoded).toBe(1);
  });

  it("works when decode is missing or rejects", async () => {
    const real = FakeImage.prototype.decode;
    FakeImage.prototype.decode = undefined as never;
    expect(() => render(<Harness start={3} />)).not.toThrow();
    FakeImage.prototype.decode = function () {
      return Promise.reject(new Error("x"));
    } as never;
    expect(() => render(<Harness start={8} />)).not.toThrow();
    await act(async () => {});
    FakeImage.prototype.decode = real;
  });

  it("preloads with exactly the url, srcset and sizes the stage renders", () => {
    render(<Harness start={3} />);
    next();
    const m = byUrl("/img/p4/view-sm?v=1");
    expect(m.srcset).toBe(cur().getAttribute("srcset"));
    expect(m.sizes).toBe(cur().getAttribute("sizes"));
    expect(m.firstSrc).toBe(cur().getAttribute("src"));
  });

  it("a preloaded neighbour shows at once, with no black and no fade-in", () => {
    render(<Harness start={3} />);
    fireEvent.load(cur());
    byUrl("/img/p4/view-sm?v=1").finish();
    next();
    expect(visible(cur())).toBe(true);
    expect(screen.queryByTestId("lightbox-prev")).toBeNull();
  });

  it("a neighbour still loading keeps the previous photo on screen", () => {
    render(<Harness start={3} />);
    fireEvent.load(cur());
    next();
    expect(visible(cur())).toBe(false);
    expect(screen.getByTestId("lightbox-prev").getAttribute("src")).toBe(
      "/img/p3/view-sm?v=1",
    );
  });

  it("the previous photo is the last one shown, also after a preloaded step", () => {
    render(<Harness start={3} />);
    fireEvent.load(cur());
    byUrl("/img/p4/view-sm?v=1").finish();
    next();
    next();
    expect(screen.getByTestId("lightbox-prev").getAttribute("src")).toBe(
      "/img/p4/view-sm?v=1",
    );
  });

  it("a preload that errored is not treated as ready", () => {
    render(<Harness start={3} />);
    fireEvent.load(cur());
    byUrl("/img/p4/view-sm?v=1").onerror?.();
    next();
    expect(visible(cur())).toBe(false);
  });

  it("unmount releases in-flight preloads", () => {
    const { unmount } = render(<Harness start={3} />);
    unmount();
    expect(live()).toEqual([]);
  });

  it("the dialog does not let the browser claim vertical pans", () => {
    render(<Harness start={3} />);
    const cls = screen.getByRole("dialog").className.split(/\s+/);
    expect(cls).toContain("touch-pinch-zoom");
    expect(cls).not.toContain("touch-pan-y");
    expect(cls).not.toContain("touch-pan-x");
    expect(cls).not.toContain("touch-manipulation");
  });

  it("an unversioned (no-store, admin) neighbour is not shown as ready", () => {
    const plain = photos(30);
    function H() {
      const [i, setI] = useState(3);
      return (
        <Lightbox
          photos={plain}
          index={i}
          t={t}
          onClose={() => {}}
          onIndexChange={setI}
        />
      );
    }
    render(<H />);
    fireEvent.load(cur());
    byUrl("/img/p4/view-sm").finish();
    next();
    expect(visible(cur())).toBe(false);
    expect(screen.getByTestId("lightbox-prev")).toBeTruthy();
  });

  it("a retried photo that was preloaded starts invisible", () => {
    render(<Harness start={3} />);
    byUrl("/img/p4/view-sm?v=1").finish();
    next();
    fireEvent.error(cur());
    fireEvent.click(
      screen.getByTestId("lightbox-error").querySelector("button")!,
    );
    expect(cur().className).toContain("opacity-0");
  });
});

describe("T6.26 touch-action while zoomed", () => {
  const touch = () =>
    screen
      .getByRole("dialog")
      .className.split(/\s+/)
      .filter((c) => c.startsWith("touch-"));
  afterEach(() => {
    delete (window as { visualViewport?: unknown }).visualViewport;
  });

  it("pans only while pinch-zoomed", () => {
    const vv = Object.assign(new EventTarget(), { scale: 1 });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: vv,
    });
    render(<Harness start={3} />);
    expect(touch()).toEqual(["touch-pinch-zoom"]);
    act(() => {
      vv.scale = 2;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(touch().sort()).toEqual([
      "touch-pan-x",
      "touch-pan-y",
      "touch-pinch-zoom",
    ]);
    act(() => {
      vv.scale = 1;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(touch()).toEqual(["touch-pinch-zoom"]);
  });
});

describe("T6.26 PreloadCache.warm", () => {
  const Real = globalThis.Image;
  beforeEach(() => {
    FakeImage.made = [];
    FakeImage.cancelled = [];
    globalThis.Image = FakeImage as unknown as typeof Image;
  });
  afterEach(() => {
    globalThis.Image = Real;
  });

  it("replacing entries on a url change does not evict unrelated ones", () => {
    const cache = new PreloadCache();
    const ps = stable.slice(0, 6);
    cache.warm(imgUrl, ps);
    const other = FakeImage.made.slice(3);
    const swap = (id: string, variant: string) => `/other/${id}/${variant}?v=1`;
    cache.warm(swap, ps.slice(0, 3));
    for (const m of other) expect(FakeImage.cancelled).not.toContain(m);
  });
});
