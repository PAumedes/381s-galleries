import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Lightbox } from "../../app/components/Lightbox";
import { BTN } from "../../app/components/lightbox/styles";
import { Close, Heart } from "../../app/components/icons";
import { photos, t } from "./fixtures";

const cls = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

describe("T6.25 mobile sizes: lightbox", () => {
  it("BTN keeps the 44px desktop size and grows to 56px on phones", () => {
    const c = BTN.split(/\s+/);
    expect(c).toContain("size-11");
    expect(c).toContain("phone:size-14");
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

  it("top bar: icons are 24px on desktop, 32px on phones; counter is 18px on phones", () => {
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
      expect(cls(svg)).toContain("phone:size-8");
    }
    const counter = screen.getByText("1 / 41");
    expect(cls(counter)).toContain("text-micro");
    expect(cls(counter)).toContain("uppercase");
    expect(cls(counter)).toContain("phone:text-[1.125rem]/6");
    expect(cls(counter)).toContain("phone:tabular-nums");
  });
});
