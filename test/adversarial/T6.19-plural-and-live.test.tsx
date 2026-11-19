import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import {
  GalleryEditView,
  type GalleryEditData,
} from "../../app/components/admin/GalleryEditView";

function show(over: Partial<GalleryEditData>) {
  const base = {
    gallery: {
      id: "g1",
      title: "T",
      slug: "t",
      clientName: "",
      eventDate: "",
      expires: { date: "", time: "" },
      status: "published",
      allowHighres: true,
      allowWeb: true,
      allowIg: false,
      allowBulk: true,
      requireEmail: false,
      mode: "proofing",
      palette: "claro",
      coverLayout: "full",
      gridStyle: "rows",
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
    photoCount: 1,
    wmCount: 0,
    photos: [],
    issues: { groups: [] },
    deleting: false,
  } as unknown as GalleryEditData;
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      Component: () => (
        <GalleryEditView
          data={{ ...base, ...over }}
          actionData={undefined as never}
        />
      ),
    },
  ]);
  return render(<Stub initialEntries={["/admin/g/g1"]} />);
}

describe("T6.19 adversarial: copy", () => {
  it("one photo, none watermarked: no 'ninguna de las 1 fotos' (broken plural)", async () => {
    show({ photoCount: 1, wmCount: 0 });
    await screen.findByLabelText(/Prueba/);
    expect(document.body.textContent).not.toMatch(/ninguna de las 1 fotos/);
  });
});
