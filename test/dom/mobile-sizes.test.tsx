import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Lightbox } from "../../app/components/Lightbox";
import { BTN } from "../../app/components/lightbox/styles";
import { Close, Heart } from "../../app/components/icons";
import { photos, t } from "./fixtures";

const cls = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

describe("T6.25 mobile sizes: lightbox", () => {
  it("BTN keeps the 44px desktop size and grows to 48px on touch", () => {
    const c = BTN.split(/\s+/);
    expect(c).toContain("size-11");
    expect(c).toContain("pointer-coarse:size-12");
  });

  it("icon className reaches the svg and keeps aria-hidden", () => {
    const { container } = render(
      <>
        <Heart className="size-7" />
        <Close className="size-7" />
      </>,
    );
    for (const svg of container.querySelectorAll("svg")) {
      expect(cls(svg)).toContain("size-7");
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("top bar: icons are 24px on desktop, 28px on touch; counter is larger on touch", () => {
    render(
      <Lightbox
        photos={photos(41)}
        index={0}
        t={t}
        onClose={vi.fn()}
        onIndexChange={vi.fn()}
        onFavorite={vi.fn()}
        onDownload={vi.fn()}
      />,
    );
    for (const name of [/close/i, /download/i, /favou?rite|add/i]) {
      const svg = screen
        .getAllByRole("button", { name })[0]!
        .querySelector("svg")!;
      expect(cls(svg)).toContain("size-6");
      expect(cls(svg)).toContain("pointer-coarse:size-7");
    }
    const counter = screen.getByText("1 / 41");
    expect(cls(counter)).toContain("text-micro");
    expect(cls(counter)).toContain("uppercase");
    expect(cls(counter)).toContain("pointer-coarse:text-[0.9375rem]/5");
    expect(cls(counter)).toContain("pointer-coarse:tabular-nums");
  });
});
