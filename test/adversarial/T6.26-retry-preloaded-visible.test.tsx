import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { Lightbox } from "../../app/components/Lightbox";
import { photos, t } from "../dom/fixtures";

const stable = photos(30);
function Harness() {
  const [i, setI] = useState(3);
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

class FakeImage {
  static made: FakeImage[] = [];
  sizes = "";
  srcset = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  firstSrc = "";
  private _src = "";
  constructor() {
    FakeImage.made.push(this);
  }
  set src(v: string) {
    if (v && !this.firstSrc) this.firstSrc = v;
    this._src = v;
  }
  get src() {
    return this._src;
  }
  removeAttribute() {}
  decode() {
    return Promise.resolve();
  }
}

describe("T6.26 retry after a preloaded photo failed in the stage", () => {
  const Real = globalThis.Image;
  beforeEach(() => {
    FakeImage.made = [];
    globalThis.Image = FakeImage as unknown as typeof Image;
  });
  afterEach(() => {
    globalThis.Image = Real;
  });

  it("the retried <img> stays invisible until it loads", () => {
    render(<Harness />);
    const p4 = FakeImage.made.find((m) => m.firstSrc === "/img/p4/view-sm")!;
    act(() => p4.onload?.());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // Stage request for p4 fails (e.g. cache miss + server error).
    fireEvent.error(screen.getByTestId("lightbox-img"));
    fireEvent.click(
      screen.getByTestId("lightbox-error").querySelector("button")!,
    );
    const img = screen.getByTestId("lightbox-img");
    expect(img.getAttribute("src")).toContain("r=1");
    expect(img.className).toContain("opacity-0");
    expect(img.className).not.toContain("opacity-100");
  });
});
