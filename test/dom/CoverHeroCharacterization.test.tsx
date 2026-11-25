import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { CoverHero } from "../../app/components/CoverHero";
import { en } from "../../app/i18n/en";
import type { CoverLayout } from "../../app/lib/design";

const LAYOUTS: CoverLayout[] = ["completa", "dividida", "centrada", "minima"];
const MOBILE = {
  src: "/img/m/view-md",
  srcSet: "/img/m/view-sm 640w, /img/m/view-md 1200w",
  focus: { x: 30, y: 60 },
  aspect: 0.75,
  placeholder: "/img/m/thumb",
};

function html(over: Record<string, unknown>) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "en", messages: en, studioName: "381 Studios" }),
      Component: () => (
        <CoverHero
          title="Boda Ana"
          date="1 November 2026"
          studio="381 Studios"
          src="/img/p0/view-lg"
          srcSet="/img/p0/view-md 1200w, /img/p0/view-lg 2048w"
          placeholder="/img/p0/thumb"
          proofing={false}
          focus={{ x: 20, y: 40 }}
          aspect={1.5}
          scrollLabel="View gallery"
          onScroll={() => {}}
          {...over}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />).container.innerHTML;
}

describe("T6.48 CoverHero markup (golden, pre-refactor)", () => {
  for (const layout of LAYOUTS)
    for (const embedded of [false, true])
      for (const proofing of [false, true])
        it(`${layout} embedded=${embedded} proofing=${proofing}`, () => {
          expect(html({ layout, embedded, proofing })).toMatchSnapshot();
        });
  for (const layout of LAYOUTS)
    for (const device of ["desktop", "mobile"] as const)
      it(`${layout} mobile cover device=${device}`, () => {
        expect(
          html({ layout, mobile: MOBILE, device, embedded: true }),
        ).toMatchSnapshot();
      });
  it("public page with mobile cover (picture sources)", () => {
    expect(html({ mobile: MOBILE, proofing: true })).toMatchSnapshot();
  });
  it("mobile-only cover and no cover at all", () => {
    expect(
      html({ src: null, srcSet: undefined, mobile: MOBILE }),
    ).toMatchSnapshot();
    expect(
      html({ src: null, srcSet: undefined, palette: "oscuro" }),
    ).toMatchSnapshot();
  });
});
