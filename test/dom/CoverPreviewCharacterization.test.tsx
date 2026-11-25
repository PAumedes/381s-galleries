import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { CoverPreview } from "../../app/components/admin/CoverPreview";
import { LivePreview } from "../../app/components/admin/LivePreview";
import { en } from "../../app/i18n/en";

const photos = [
  { id: "p1", name: "IMG_1" },
  { id: "p2", name: "IMG_2" },
  { id: "p3", name: "IMG_3" },
];
const versions = { p1: "t1", p2: "t2", p3: "t3" };

function mount(node: React.ReactNode) {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "en", messages: en, studioName: "381 Studios" }),
      Component: () => <>{node}</>,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />).container;
}

const coverProps = {
  title: "Boda Ana",
  eventDate: "2026-11-01",
  palette: "arena" as const,
  coverLayout: "dividida" as const,
  proofing: false,
  coverId: "p2",
  coverWidth: 3000,
  coverHeight: 2000,
  initialFocus: { x: 30, y: 70 },
  photos,
  versions,
};

describe("T6.48 CoverPreview markup (golden, pre-refactor)", () => {
  it("desktop, then phone fallback, then centered", async () => {
    const c = mount(<CoverPreview {...coverProps} />);
    await screen.findByTestId("cover-preview");
    expect(c.innerHTML).toMatchSnapshot("desktop");
    fireEvent.click(
      screen.getAllByRole("button", { name: /phone|mobile/i })[0],
    );
    expect(c.innerHTML).toMatchSnapshot("phone fallback");
    fireEvent.click(screen.getByRole("button", { name: /center|centrar/i }));
    expect(c.innerHTML).toMatchSnapshot("centered");
  });
  it("mobile cover editing, no-wm warning, auto cover, feedback", async () => {
    const c = mount(
      <CoverPreview
        {...coverProps}
        proofing
        coverAuto
        mobileNoWm
        mobileCover={{
          id: "p3",
          width: 2000,
          height: 3000,
          focus: { x: 10, y: 20 },
        }}
        device="mobile"
        actionData={{ intent: "focus", ok: true, message: "Saved" } as never}
      />,
    );
    await screen.findByTestId("cover-preview");
    expect(c.innerHTML).toMatchSnapshot();
  });
  it("error feedback, no cover, no photos", async () => {
    const c = mount(
      <CoverPreview
        {...coverProps}
        coverId={null}
        coverWidth={null}
        coverHeight={null}
        initialFocus={null}
        photos={[]}
        actionData={{ intent: "cover", ok: false, error: "nope" } as never}
      />,
    );
    await screen.findByTestId("cover-preview");
    expect(c.innerHTML).toMatchSnapshot();
  });
});

describe("T6.48 LivePreview markup (golden, pre-refactor)", () => {
  const base = {
    title: "Boda Ana",
    eventDate: "2026-11-01",
    palette: "oscuro" as const,
    coverLayout: "completa" as const,
    proofing: false,
    cover: { id: "p1", aspect: 1.5, focus: { x: 20, y: 30 } },
    versions,
    onDevice: () => {},
  };
  const grid = [
    { id: "p1", set: "A", width: 3000, height: 2000 },
    { id: "p2", set: "A", width: 2000, height: 3000 },
    { id: "p3", set: "B" },
  ];
  it("cover only desktop / mobile with headings and children", async () => {
    const a = mount(
      <LivePreview
        {...base}
        device="desktop"
        heading="Preview"
        hint="Hint"
        headingLevel={3}
      >
        <p>child</p>
      </LivePreview>,
    );
    await screen.findByTestId("live-preview");
    expect(a.innerHTML).toMatchSnapshot("desktop");
    const b = mount(
      <LivePreview
        {...base}
        device="mobile"
        mobileCover={{ id: "p3", aspect: 0.66, focus: null }}
        cover={null}
      />,
    );
    expect(b.innerHTML).toMatchSnapshot("mobile");
  });
  it("full page grid, proofing, gap and style", async () => {
    const c = mount(
      <LivePreview
        {...base}
        device="desktop"
        proofing
        photos={grid}
        gridStyle="columnas"
        gridGap="amplio"
        heading="Preview"
      />,
    );
    await screen.findByTestId("live-preview");
    expect(c.innerHTML).toMatchSnapshot("page");
  });
});
