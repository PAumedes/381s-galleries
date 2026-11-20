import { render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CoverHero } from "../../app/components/CoverHero";

vi.mock("../../app/components/Logo", () => ({ Logo: () => null }));
afterEach(() => vi.unstubAllGlobals());

it("proofing, narrow viewport, mobile cover only: the shown image is covered by the shield", () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  const { container } = render(
    <CoverHero
      title="T"
      date={null}
      studio="S"
      src={null}
      proofing
      focus={null}
      scrollLabel="go"
      mobile={{ src: "/m.jpg", focus: null, aspect: 1.5 }}
    />,
  );
  expect(container.querySelector("img[data-cover-img]")).not.toBeNull();
  expect(
    container.querySelector('[data-testid="cover-shield"]'),
  ).not.toBeNull();
});
