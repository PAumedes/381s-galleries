import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, Link } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GalleryEditView,
  type GalleryEditData,
} from "../../app/components/admin/GalleryEditView";

const data: GalleryEditData = {
  gallery: {
    id: "g1",
    title: "Boda",
    slug: "boda",
    clientName: null,
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
};

function show() {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      Component: () => (
        <>
          <Link to="/admin/g/g1/activity">go-activity</Link>
          <GalleryEditView data={data} actionData={undefined} />
        </>
      ),
    },
    { path: "/admin/g/g1/activity", Component: () => <p>ACTIVITY PAGE</p> },
  ]);
  return render(<Stub initialEntries={["/admin/g/g1?tab=diseno"]} />);
}
// jsdom has no window.confirm: install a stub we can spy on.
beforeEach(() => {
  window.confirm = () => true;
});
afterEach(() => vi.restoreAllMocks());

describe("unsaved design changes", () => {
  it("clean: leaving does not ask", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    show();
    await userEvent.click(await screen.findByText("go-activity"));
    expect(await screen.findByText("ACTIVITY PAGE")).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });
  it("dirty: leaving asks; cancel stays, accept leaves", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    show();
    await userEvent.click(await screen.findByLabelText("Arena"));
    await userEvent.click(screen.getByText("go-activity"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0]).toMatch(/sin guardar/);
    expect(screen.queryByText("ACTIVITY PAGE")).toBeNull();
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByText("go-activity"));
    expect(await screen.findByText("ACTIVITY PAGE")).toBeTruthy();
  });
  it("dirty: switching tabs inside the editor does not ask", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    show();
    await userEvent.click(await screen.findByLabelText("Arena"));
    await userEvent.click(screen.getByRole("link", { name: /Datos/ }));
    expect(confirm).not.toHaveBeenCalled();
  });
  it("beforeunload is blocked only while dirty", async () => {
    show();
    const fire = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    await screen.findByLabelText("Arena");
    expect(fire()).toBe(false);
    await userEvent.click(screen.getByLabelText("Arena"));
    expect(fire()).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /Descartar/i }));
    expect(fire()).toBe(false);
  });
});
