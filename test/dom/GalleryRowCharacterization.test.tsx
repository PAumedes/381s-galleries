import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { GalleryRow } from "../../app/components/admin/GalleryRow";
import type { GalleryListRow } from "../../app/lib/server/admin-galleries/list";

const row = (over: Partial<GalleryListRow> = {}): GalleryListRow => ({
  id: "g1",
  title: "Boda Ana",
  slug: "boda-ana",
  clientName: null,
  client: null,
  eventDate: "2026-11-01",
  status: "published",
  mode: "delivery",
  expiresAt: null,
  expired: false,
  coverPhotoId: "p1",
  photoCount: 1200,
  views: 3300,
  downloads: 7,
  issueCount: 0,
  deleting: false,
  ...over,
});

function html(g: GalleryListRow) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <table>
          <tbody>
            <GalleryRow
              g={g}
              onOpen={() => {}}
              expiry={(iso) => (iso ? `exp ${iso}` : "never")}
            />
          </tbody>
        </table>
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />).container.innerHTML;
}

describe("T6.48 GalleryRow markup (golden, pre-refactor)", () => {
  const cases: [string, Partial<GalleryListRow>][] = [
    ["plain", {}],
    ["no cover, no date, no client", { coverPhotoId: null, eventDate: null }],
    [
      "client folder",
      {
        client: { id: "c1", name: "Ana Pérez", slug: "ana" },
        clientName: "legacy",
      },
    ],
    ["legacy client name", { clientName: "Ana (legacy)" }],
    ["draft, issues", { status: "draft", issueCount: 12 }],
    [
      "proofing, expired, deleting",
      {
        mode: "proofing",
        expired: true,
        expiresAt: "2026-01-01T00:00:00Z",
        deleting: true,
      },
    ],
  ];
  for (const [name, over] of cases)
    it(name, () => {
      expect(html(row(over))).toMatchSnapshot();
    });
});
