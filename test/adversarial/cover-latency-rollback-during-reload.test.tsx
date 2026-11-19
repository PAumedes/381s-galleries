import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub, useActionData, useLoaderData } from "react-router";
import { afterEach, expect, it } from "vitest";
import {
  GalleryEditView,
  type GalleryEditData,
} from "../../app/components/admin/GalleryEditView";
import type { GalleryActionResult } from "../../app/lib/server/admin-galleries";

const photos = ["p1", "p2", "p3"].map((id, i) => ({
  id,
  name: `IMG_${i + 1}`,
  v: `${id}${id}${id}${id}`,
  set: "H",
  takenAt: null,
  width: 300,
  height: 200,
}));
const gallery = {
  id: "g1",
  title: "Boda",
  slug: "b",
  clientName: "A",
  eventDate: null,
  expires: null,
  status: "draft",
  allowHighres: true,
  allowWeb: true,
  allowIg: false,
  allowBulk: true,
  requireEmail: true,
  mode: "delivery",
  palette: "claro",
  coverLayout: "completa",
  gridStyle: "filas",
  gridGap: "normal",
  hasPin: false,
  coverPhotoId: "p2",
  coverFocus: null,
  coverPhotoIdMobile: null,
  coverFocusMobile: null,
} as unknown as GalleryEditData["gallery"];

afterEach(cleanup);

it("a FAILED save must not keep showing the optimistic cover while the error is already visible (slow revalidation)", async () => {
  let loads = 0;
  let releaseReload!: () => void;
  const reload = new Promise<void>((r) => (releaseReload = r));
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      loader: async () => {
        if (++loads > 1) await reload;
        return {
          gallery,
          hasWmFiles: true,
          hasThumbWmFiles: true,
          photos,
          version: "v1",
          issues: { groups: [], truncated: 0, total: 0 },
        };
      },
      action: async () =>
        ({
          intent: "cover",
          ok: false,
          error: "No se pudo guardar la portada.",
        }) satisfies GalleryActionResult,
      Component: () => (
        <GalleryEditView
          data={useLoaderData() as GalleryEditData}
          actionData={useActionData() as GalleryActionResult | undefined}
        />
      ),
    },
  ]);
  render(<Stub initialEntries={["/admin/g/g1?tab=portada"]} />);
  await screen.findByTestId("cover-preview");
  await userEvent.click(screen.getByRole("button", { name: "Portada móvil" }));
  await userEvent.click(screen.getByRole("button", { name: "Usar IMG_3" }));
  const src = () =>
    document
      .querySelector('[data-frame="mobile"] img[data-cover-img]')
      ?.getAttribute("src") ?? "";
  // action has failed, error is on screen, reload still pending
  await screen.findByRole("alert");
  expect(src()).not.toContain("/p3/");
  releaseReload();
  await waitFor(() => expect(src()).toContain("/p2/"));
});
