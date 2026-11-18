import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Lightbox } from "../../app/components/Lightbox";
import { photos, t } from "./fixtures";

function setup(index = 3) {
  const onClose = vi.fn();
  const onIndexChange = vi.fn();
  render(
    <Lightbox
      photos={photos(10)}
      index={index}
      t={t}
      onClose={onClose}
      onIndexChange={onIndexChange}
      onFavorite={() => {}}
      onDownload={() => {}}
    />,
  );
  return { onClose, onIndexChange };
}
const btn = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
const stage = () => screen.getByTestId("lightbox-stage");
// jsdom innerWidth is 1024 and innerHeight 768.
const clickAt = (x: number, y: number) =>
  fireEvent.click(stage(), { clientX: x, clientY: y });

describe("Lightbox navigation targets", () => {
  it("arrows are big side zones (>= 64px wide, full-height band)", () => {
    setup();
    for (const name of ["Previous", "Next"]) {
      const c = btn(name).className;
      expect(c).toMatch(/\bmin-w-16\b/);
      expect(c).toMatch(/\bw-\[1[2-8]vw\]/);
      expect(c).toMatch(/\binset-y-16\b/);
      expect(c).toContain("pointer-coarse:hidden");
      expect(btn(name).querySelector("svg")?.getAttribute("class")).toMatch(
        /\bsize-12\b/,
      );
    }
  });

  it("every clickable control shows a pointer cursor and a hover/focus state", () => {
    setup();
    for (const name of ["Previous", "Next", "Close", "Download"]) {
      const c = btn(name).className;
      expect(c).toContain("cursor-pointer");
      expect(c).toContain("hover:text-white");
      expect(c).toContain("focus-visible:");
    }
    expect(btn("Previous").className).toContain("hover:bg-white/");
    expect(btn("Next").className).toContain("focus-visible:bg-white/");
  });

  it("the close button stays prominent (44px+)", () => {
    setup();
    expect(btn("Close").className).toMatch(/\bsize-1[1-9]\b|\bsize-[2-9]\d\b/);
  });

  it("clicking the arrows navigates and never closes", async () => {
    const user = userEvent.setup();
    const { onClose, onIndexChange } = setup();
    await user.click(btn("Next"));
    expect(onIndexChange).toHaveBeenLastCalledWith(4);
    await user.click(btn("Previous"));
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a quick double click on an arrow navigates twice and never closes", async () => {
    const user = userEvent.setup();
    const { onClose, onIndexChange } = setup();
    await user.dblClick(btn("Next"));
    expect(onIndexChange).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a click on a disabled arrow at the end of the gallery never closes", async () => {
    const user = userEvent.setup();
    const { onClose } = setup(9);
    await user.dblClick(btn("Next"));
    expect(onClose).not.toHaveBeenCalled();
    // and the disabled arrow does not let clicks fall through to the stage
    expect(btn("Next").className).not.toContain("pointer-events-none");
  });

  it("backdrop click inside a side zone does nothing", () => {
    const { onClose, onIndexChange } = setup();
    clickAt(40, 400); // left zone, beside the image
    clickAt(1000, 400); // right zone
    expect(onClose).not.toHaveBeenCalled();
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("backdrop click near the top bar does nothing", () => {
    const { onClose } = setup();
    clickAt(512, 20);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("backdrop click on empty area in the middle band closes", () => {
    const { onClose } = setup();
    clickAt(512, 740); // below the photo, away from controls
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicks on the image never close", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId("lightbox-img"), {
      clientX: 512,
      clientY: 740,
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keyboard is unchanged", async () => {
    const user = userEvent.setup();
    const { onClose, onIndexChange } = setup();
    await user.keyboard("{ArrowRight}");
    expect(onIndexChange).toHaveBeenLastCalledWith(4);
    await user.keyboard("{ArrowLeft}");
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
