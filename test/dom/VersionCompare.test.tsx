import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Lightbox } from "../../app/components/Lightbox";
import type { GalleryPhoto } from "../../app/components/types";
import { en } from "../../app/i18n/en";
import { es } from "../../app/i18n/es";
import { enPublic } from "../../app/i18n/en.public";
import { esPublic } from "../../app/i18n/es.public";
import { photos, t } from "./fixtures";

afterEach(cleanup);

const ver = (n: number) => ({
  n,
  round: n === 1 ? null : n,
  at: `2026-03-0${n}T15:00:00.000Z`,
  v: `t${n}`,
});
const versioned = (over: Partial<GalleryPhoto> = {}): GalleryPhoto => ({
  ...photos(1)[0],
  id: "A",
  v: "t2",
  ver: 2,
  versions: [ver(1), ver(2)],
  ...over,
});

async function open(
  list: GalleryPhoto[],
  { onClose = vi.fn(), onIndexChange = vi.fn(), index = 0, lang = "en" } = {},
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
      Component: () => (
        <Lightbox
          photos={list}
          index={index}
          t={t}
          onClose={onClose}
          onIndexChange={onIndexChange}
        />
      ),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
  await screen.findByRole("dialog");
  return { onClose, onIndexChange };
}

const compareBtn = () => screen.queryByTestId("compare-open");
const imgs = () => ({
  a: screen.getByTestId("compare-img-a") as HTMLImageElement,
  b: screen.getByTestId("compare-img-b") as HTMLImageElement,
});
const loadBoth = () => {
  fireEvent.load(imgs().a);
  fireEvent.load(imgs().b);
};

describe("T6.53e compare button", () => {
  it("offers 'Compare with v1' for a photo shown at v2", async () => {
    await open([versioned()]);
    expect(compareBtn()?.textContent).toBe("Compare with v1");
  });
  it("compares the shown version with the previous LISTED one (v3 vs v1 when v2 has no image)", async () => {
    await open([versioned({ ver: 3, versions: [ver(1), ver(3)] })]);
    expect(compareBtn()?.textContent).toBe("Compare with v1");
  });
  it.each([
    ["no history", { versions: undefined }],
    ["shown v1", { ver: 1, versions: [ver(1), ver(2)] }],
    ["a placeholder card", { noPreview: true as const }],
    ["an unversioned photo", { ver: undefined, versions: undefined }],
  ])("has no button with %s", async (_n, over) => {
    await open([versioned(over)]);
    expect(compareBtn()).toBeNull();
    expect(screen.queryByTestId("compare")).toBeNull();
  });
  it("an unversioned album renders no compare markup or i18n at all", async () => {
    await open(photos(2));
    expect(document.body.innerHTML).not.toMatch(/compare/i);
  });
  it("sits in the history cluster (bottom-left), not on its own layer", async () => {
    await open([versioned()]);
    expect(screen.getByTestId("lightbox-versions").contains(compareBtn())).toBe(
      true,
    );
  });
});

describe("T6.53e flip", () => {
  it("opens on the two existing previews of both versions, shown version first, with a v2 / v1 label", async () => {
    const user = userEvent.setup();
    await open([versioned()]);
    await user.click(compareBtn()!);
    expect(screen.getByTestId("compare")).toBeTruthy();
    expect(imgs().a.getAttribute("src")).toBe("/img/A/view-sm?ver=2&v=t2");
    expect(imgs().b.getAttribute("src")).toBe("/img/A/view-sm?ver=1&v=t1");
    expect(screen.getByTestId("compare-label").textContent).toBe("v2 / v1");
    expect(imgs().a.dataset.active).toBe("true");
    expect(imgs().b.dataset.active).toBe("false");
  });
  it("shows a loading state until BOTH previews loaded", async () => {
    const user = userEvent.setup();
    await open([versioned()]);
    await user.click(compareBtn()!);
    expect(screen.getByTestId("compare-loading").textContent).toBe(
      "Loading previews…",
    );
    fireEvent.load(imgs().a);
    expect(screen.getByTestId("compare-loading")).toBeTruthy();
    fireEvent.load(imgs().b);
    expect(screen.queryByTestId("compare-loading")).toBeNull();
  });
  it("a click on the picture flips A/B and the label marks the shown one", async () => {
    const user = userEvent.setup();
    await open([versioned()]);
    await user.click(compareBtn()!);
    loadBoth();
    const flip = screen.getByTestId("compare-flip");
    await user.click(flip);
    expect(imgs().a.dataset.active).toBe("false");
    expect(imgs().b.dataset.active).toBe("true");
    expect(screen.getByTestId("compare-label").textContent).toBe("v2 / v1");
    expect(
      screen.getByTestId("compare-label-1").getAttribute("aria-current"),
    ).toBe("true");
    expect(
      screen.getByTestId("compare-label-2").getAttribute("aria-current"),
    ).toBeNull();
    await user.click(flip);
    expect(imgs().a.dataset.active).toBe("true");
  });
  it("Space toggles it from the keyboard, and does not navigate or close", async () => {
    const user = userEvent.setup();
    const { onClose, onIndexChange } = await open([versioned()]);
    await user.click(compareBtn()!);
    loadBoth();
    screen.getByTestId("compare-flip").focus();
    await user.keyboard(" ");
    expect(imgs().b.dataset.active).toBe("true");
    await user.keyboard(" ");
    expect(imgs().a.dataset.active).toBe("true");
    expect(onClose).not.toHaveBeenCalled();
    expect(onIndexChange).not.toHaveBeenCalled();
  });
  it("moves the focus into the comparison and back to the button on close", async () => {
    const user = userEvent.setup();
    await open([versioned()]);
    await user.click(compareBtn()!);
    expect(document.activeElement).toBe(screen.getByTestId("compare-flip"));
    await user.click(screen.getByRole("button", { name: "Close comparison" }));
    expect(screen.queryByTestId("compare")).toBeNull();
    expect(document.activeElement).toBe(compareBtn());
  });
  it("clicking inside the comparison never closes the lightbox", async () => {
    const user = userEvent.setup();
    const { onClose } = await open([versioned()]);
    await user.click(compareBtn()!);
    await user.click(screen.getByTestId("compare"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("T6.53e slider", () => {
  async function slider() {
    const user = userEvent.setup();
    const ctx = await open([versioned()]);
    await user.click(compareBtn()!);
    loadBoth();
    await user.click(screen.getByTestId("compare-mode-slide"));
    return { user, ...ctx, handle: screen.getByRole("slider") };
  }
  it("has slider semantics and starts in the middle", async () => {
    const { handle } = await slider();
    expect(handle.getAttribute("aria-valuemin")).toBe("0");
    expect(handle.getAttribute("aria-valuemax")).toBe("100");
    expect(handle.getAttribute("aria-valuenow")).toBe("50");
    expect(handle.getAttribute("aria-orientation")).toBe("horizontal");
    expect(handle.getAttribute("aria-valuetext")).toBe("v2 shown 50%");
    expect(handle.getAttribute("aria-label")).toBe("Compare v2 with v1");
    expect(handle.tabIndex).toBe(0);
    expect(
      screen.getByTestId("compare-mode-slide").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByTestId("compare-mode-flip").getAttribute("aria-pressed"),
    ).toBe("false");
  });
  it("uses clip-path on the shown (top) image and keeps both in one frame", async () => {
    const { handle, user } = await slider();
    expect(imgs().a.style.clipPath).toBe("inset(0 50% 0 0)");
    expect(imgs().b.style.clipPath).toBe("");
    handle.focus();
    await user.keyboard("{ArrowRight}");
    expect(imgs().a.style.clipPath).toBe("inset(0 45% 0 0)");
    expect(imgs().a.parentElement).toBe(imgs().b.parentElement);
    expect(imgs().a.className).toContain("object-contain");
    expect(imgs().b.className).toContain("object-contain");
    expect(imgs().a.className).toBe(imgs().b.className);
  });
  it("keys: arrows, Home, End; they never navigate the lightbox", async () => {
    const { handle, user, onIndexChange, onClose } = await slider();
    handle.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(handle.getAttribute("aria-valuenow")).toBe("60");
    await user.keyboard("{ArrowLeft}");
    expect(handle.getAttribute("aria-valuenow")).toBe("55");
    await user.keyboard("{End}");
    expect(handle.getAttribute("aria-valuenow")).toBe("100");
    await user.keyboard("{ArrowRight}");
    expect(handle.getAttribute("aria-valuenow")).toBe("100");
    await user.keyboard("{Home}");
    expect(handle.getAttribute("aria-valuenow")).toBe("0");
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
  it("a pointer press and drag moves the handle (clamped to the frame)", async () => {
    const { handle } = await slider();
    const frame = screen.getByTestId("compare-frame");
    frame.getBoundingClientRect = () =>
      ({
        left: 100,
        width: 200,
        top: 0,
        right: 300,
        bottom: 100,
        height: 100,
      }) as DOMRect;
    frame.setPointerCapture = vi.fn();
    const at = (clientX: number) => ({
      clientX,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerDown(frame, at(150));
    expect(handle.getAttribute("aria-valuenow")).toBe("25");
    fireEvent.pointerMove(frame, at(250));
    expect(handle.getAttribute("aria-valuenow")).toBe("75");
    fireEvent.pointerMove(frame, at(900));
    expect(handle.getAttribute("aria-valuenow")).toBe("100");
    fireEvent.pointerUp(frame, at(900));
    fireEvent.pointerMove(frame, at(120));
    expect(handle.getAttribute("aria-valuenow")).toBe("100");
  });
  it("a touch drag on the slider does not swipe to the next photo; the same drag on the flip picture does", async () => {
    const user = userEvent.setup();
    const onIndexChange = vi.fn();
    await open([versioned(), versioned({ id: "B" })], { onIndexChange });
    await user.click(compareBtn()!);
    loadBoth();
    const swipe = (el: Element) => {
      const at = (clientX: number) => ({
        clientX,
        clientY: 300,
        pointerId: 7,
        pointerType: "touch",
      });
      fireEvent.pointerDown(el, at(300));
      fireEvent.pointerMove(el, at(150));
      fireEvent.pointerMove(el, at(40));
      fireEvent.pointerUp(el, at(40));
    };
    await user.click(screen.getByTestId("compare-mode-slide"));
    swipe(screen.getByTestId("compare-frame"));
    expect(onIndexChange).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("compare-mode-flip"));
    swipe(screen.getByTestId("compare-flip"));
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });
  it("switching back to flip keeps the same two images", async () => {
    const { user } = await slider();
    await user.click(screen.getByTestId("compare-mode-flip"));
    expect(screen.getByTestId("compare-flip")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(imgs().a.style.clipPath).toBe("");
  });
});

describe("T6.53e Escape order", () => {
  it("Escape closes the comparison first, the lightbox on the second press", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    await open([versioned()], { onClose });
    await user.click(compareBtn()!);
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("compare")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
  it("with the history open too: compare, then history, then lightbox", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    await open([versioned()], { onClose });
    await user.click(screen.getByTestId("versions-toggle"));
    expect(screen.getByTestId("versions-panel")).toBeTruthy();
    await user.click(compareBtn()!);
    // The comparison takes the screen; the panel waits underneath.
    expect(screen.queryByTestId("versions-panel")).toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("compare")).toBeNull();
    expect(screen.getByTestId("versions-panel")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("versions-panel")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
  it("Escape works with the focus on the close button of the lightbox", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    await open([versioned()], { onClose });
    await user.click(compareBtn()!);
    screen.getByRole("button", { name: "Close", exact: true }).focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("compare")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("T6.53e errors and navigation", () => {
  it("an image that fails shows an alert with a retry that reloads both", async () => {
    const user = userEvent.setup();
    await open([versioned()]);
    await user.click(compareBtn()!);
    fireEvent.load(imgs().a);
    fireEvent.error(imgs().b);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "One of the previews could not be loaded",
    );
    expect(screen.queryByTestId("compare-loading")).toBeNull();
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("compare-loading")).toBeTruthy();
  });
  it("navigating to another photo closes the comparison", async () => {
    const user = userEvent.setup();
    const list = [versioned(), versioned({ id: "B" })];
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        loader: () => ({ lang: "en", messages: en, studioName: "381 Studios" }),
        Component: function C() {
          const [i, setI] = useState(0);
          return (
            <Lightbox
              photos={list}
              index={i}
              t={t}
              onClose={vi.fn()}
              onIndexChange={setI}
            />
          );
        },
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    await screen.findByRole("dialog");
    await user.click(compareBtn()!);
    expect(screen.getByTestId("compare")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByTestId("compare")).toBeNull();
    expect(compareBtn()).not.toBeNull();
  });
});

describe("T6.53e motion and copy", () => {
  it("no animated transitions in the comparison (reduced motion needs none)", async () => {
    const user = userEvent.setup();
    await open([versioned()]);
    await user.click(compareBtn()!);
    const html = screen.getByTestId("compare").outerHTML;
    expect(html).not.toMatch(/transition|animate|duration|ease-/);
    await user.click(screen.getByTestId("compare-mode-slide"));
    expect(screen.getByTestId("compare").outerHTML).not.toMatch(
      /transition|animate|duration|ease-/,
    );
  });
  it("both languages have the copy, with no straight quotes", () => {
    const keys = Object.keys(esPublic).filter((k) => k.startsWith("compare."));
    expect(keys.length).toBeGreaterThan(8);
    expect(
      Object.keys(enPublic).filter((k) => k.startsWith("compare.")),
    ).toEqual(keys);
    for (const k of keys) {
      for (const d of [esPublic, enPublic] as Record<string, string>[]) {
        expect(d[k], k).not.toMatch(/["']/);
      }
    }
  });
});
