import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, Outlet, useNavigate, useParams } from "react-router";
import { describe, expect, it } from "vitest";
import {
  GalleryEditView,
  type GalleryEditData,
} from "../../app/components/admin/GalleryEditView";
import { allMessages } from "../../app/i18n/dictionaries";

const mk = (id: string, title: string): GalleryEditData => ({
  gallery: {
    id,
    title,
    slug: id,
    clientName: "",
    eventDate: null,
    expires: null,
    status: "draft",
    allowHighres: true,
    allowWeb: true,
    allowIg: true,
    allowBulk: true,
    requireEmail: false,
    mode: "delivery",
    palette: "claro",
    coverLayout: "completa",
    gridStyle: "filas",
    gridGap: "normal",
    hasPin: false,
    showOnHome: false,
    coverPhotoId: null,
    coverFocus: null,
    coverPhotoIdMobile: null,
    coverFocusMobile: null,
  },
  hasWmFiles: false,
  hasThumbWmFiles: false,
  photos: [],
  version: "v",
  issues: { groups: [], truncated: 0, total: 0 },
});

describe("T6.12 editor reused across :id (history jump from gallery A to B)", () => {
  it("shows (and would post) gallery B's title, not A's", async () => {
    const data: Record<string, GalleryEditData> = {
      ga: mk("ga", "Gallery A"),
      gb: mk("gb", "Gallery B"),
    };
    function Page() {
      const { id } = useParams();
      const go = useNavigate();
      return (
        <>
          <button onClick={() => go("/admin/g/gb")}>jump</button>
          <GalleryEditView data={data[id!]!} actionData={undefined} />
        </>
      );
    }
    const Stub = createRoutesStub([
      {
        id: "root",
        path: "/",
        loader: () => ({
          lang: "es",
          messages: allMessages("es"),
          studioName: "E",
        }),
        Component: () => <Outlet />,
        children: [{ path: "admin/g/:id", Component: Page }],
      },
    ]);
    render(<Stub initialEntries={["/admin/g/ga"]} />);
    expect(await screen.findByDisplayValue("Gallery A")).toBeTruthy();
    await userEvent.click(screen.getByText("jump"));
    expect(await screen.findByDisplayValue("Gallery B")).toBeTruthy();
  });
});
