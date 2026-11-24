import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import {
  ActivityView,
  type ActivityViewData,
} from "../../app/components/admin/ActivityView";

/** Normalised DOM snapshots so ActivityView can be split with identical markup. */

const visitor = {
  country: "AR",
  region: "B",
  city: "Villa Luro",
  lang: "es",
  referrerHost: "instagram.com",
  browser: "Safari",
  browserVersion: "17",
  os: "iOS",
  device: "mobile",
};
const row = (over = {}) => ({
  id: "d1",
  createdAt: "2026-11-16T02:30:00Z",
  email: "ana@example.com",
  variant: "web",
  ...visitor,
  photoId: "p1",
  name: "IMG_1",
  set: "Highlights",
  ...over,
});
const view = (over = {}) => ({
  createdAt: "2026-11-16T02:30:00Z",
  email: null as string | null,
  ...visitor,
  continent: null,
  timezone: null,
  asn: null,
  asOrg: null,
  ...over,
});

const data = {
  gallery: { id: "g1", title: "Boda Ana", slug: "boda-ana" },
  breakdown: {
    countries: [{ value: "AR", count: 5 }],
    devices: [{ value: "mobile", count: 4 }],
    browsers: [],
    referrers: [{ value: "instagram.com", count: 1 }],
  },
  summary: { views: 7, visitors: 2, photos: 5, bulks: 1 },
  rows: [
    row(),
    row({ id: "d2", email: null, photoId: null, name: null, variant: "ig" }),
    {
      ...row({ id: "h1", photoId: null, name: null, variant: "highres" }),
      bulk: {
        scope: "set:Fiesta",
        count: 2,
        children: [row({ id: "c1", name: "IMG_8", photoId: "p8" })],
      },
    },
  ],
  next: "2026-01-01T00:00:00Z|d0",
  filters: { visitor: "ana@example.com", size: "web" },
  visitorOptions: ["ana@example.com"],
  views: [view(), view({ email: "bob@example.com", country: null })],
} as unknown as ActivityViewData;

const empty = {
  ...data,
  rows: [],
  views: [],
  next: null,
  breakdown: { countries: [], devices: [], browsers: [], referrers: [] },
} as unknown as ActivityViewData;

function show(d: ActivityViewData) {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1/activity",
      Component: () => <ActivityView data={d} />,
    },
  ]);
  return render(<Stub initialEntries={["/admin/g/g1/activity"]} />);
}

describe("ActivityView characterization (T6.47)", () => {
  it("populated", async () => {
    const { container } = show(data);
    await screen.findByRole("table", { name: "Descargas" });
    expect(container.innerHTML).toMatchSnapshot();
  });
  it("populated, bulk expanded", async () => {
    const { container } = show(data);
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /fotos/i }));
    expect(container.innerHTML).toMatchSnapshot();
  });
  it("empty", async () => {
    const { container } = show(empty);
    await screen.findByRole("heading", { level: 1 });
    expect(container.innerHTML).toMatchSnapshot();
  });
});
