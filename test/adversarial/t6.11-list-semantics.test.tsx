import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { GalleryList } from "../../app/components/admin/GalleryList";

describe("T6.11 adversarial: list cards", () => {
  it("keeps table semantics when the table is restyled to display:block/grid", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin",
        Component: () => (
          <GalleryList
            galleries={[
              {
                id: "g1",
                title: "Boda",
                slug: "boda",
                clientName: null,
                eventDate: null,
                status: "published",
                expiresAt: null,
                expired: false,
                coverPhotoId: null,
                photoCount: 1,
                views: 0,
                downloads: 0,
                issueCount: 0,
              },
            ]}
            filter="todas"
            total={1}
          />
        ),
      },
    ]);
    render(<Stub initialEntries={["/admin"]} />);
    const link = await screen.findByRole("link", { name: "Boda" });
    const table = link.closest("table")!;
    const tr = link.closest("tr")!;
    // Chrome/Safari drop table/row/cell roles when display is block/grid.
    expect(table.className).toMatch(/(^|\s)block(\s|$)/);
    expect(table.getAttribute("role")).toBe("table");
    expect(tr.getAttribute("role")).toBe("row");
    expect(link.closest("td")!.getAttribute("role")).toBe("cell");
  });
});
