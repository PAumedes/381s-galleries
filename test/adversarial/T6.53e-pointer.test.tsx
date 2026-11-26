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
import { photos, t } from "../dom/fixtures";

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
const frameBox = (frame: HTMLElement) => {
  frame.getBoundingClientRect = () =>
    ({ left: 100, width: 200, top: 0, right: 300, bottom: 100, height: 100 }) as DOMRect;
  frame.setPointerCapture = vi.fn();
};
async function slide() {
  const user = userEvent.setup();
  await open([versioned()]);
  await user.click(compareBtn()!);
  await user.click(screen.getByTestId("compare-mode-slide"));
  const frame = screen.getByTestId("compare-frame");
  frameBox(frame);
  return { frame, handle: screen.getByRole("slider") };
}

describe("T6.53e adversarial pointer handling", () => {
  it("a second finger (pinch) does not hijack the handle while the first is dragging", async () => {
    const { frame, handle } = await slide();
    fireEvent.pointerDown(frame, { clientX: 150, pointerId: 1, pointerType: "touch" });
    expect(handle.getAttribute("aria-valuenow")).toBe("25");
    fireEvent.pointerDown(frame, { clientX: 280, pointerId: 2, pointerType: "touch" });
    expect(handle.getAttribute("aria-valuenow")).toBe("25");
    fireEvent.pointerMove(frame, { clientX: 160, pointerId: 1, pointerType: "touch" });
    expect(handle.getAttribute("aria-valuenow")).toBe("30");
  });
  it("a right-click does not start a drag or move the handle", async () => {
    const { frame, handle } = await slide();
    fireEvent.pointerDown(frame, { clientX: 150, pointerId: 1, pointerType: "mouse", button: 2 });
    expect(handle.getAttribute("aria-valuenow")).toBe("50");
  });
});
