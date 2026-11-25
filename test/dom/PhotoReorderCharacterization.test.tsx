import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import {
  PhotoReorder,
  type ReorderPhoto,
} from "../../app/components/admin/PhotoReorder";

const photos: ReorderPhoto[] = [
  {
    id: "a",
    set: "Highlights",
    name: "IMG_3",
    takenAt: "2026-01-01T12:00:00Z",
  },
  {
    id: "b",
    set: "Highlights",
    name: "IMG_1",
    takenAt: "2026-01-01T10:00:00Z",
    v: "t1",
  },
  { id: "c", set: "Highlights", name: "IMG_2", takenAt: null },
  { id: "d", set: "Fiesta", name: "F_2", takenAt: null },
  { id: "e", set: "Fiesta", name: "F_1", takenAt: null },
];

async function show(props: Record<string, unknown> = {}) {
  const Stub = createRoutesStub([
    {
      path: "/admin/g/g1",
      Component: () => (
        <PhotoReorder
          photos={photos}
          version="v1"
          coverPhotoId="b"
          mobileCoverId="d"
          {...props}
        />
      ),
    },
  ]);
  const r = render(<Stub initialEntries={["/admin/g/g1"]} />);
  await screen.findByRole("group", { name: "Highlights" });
  return r.container;
}
const tile = (id: string) => document.querySelector(`[data-photo-id="${id}"]`)!;
const dt = {
  setData() {},
  getData: () => "",
  effectAllowed: "",
  dropEffect: "",
};
const press = (id: string, key: string) =>
  fireEvent.keyDown(tile(id).querySelector("[role=button]")!, { key });

describe("T6.48 PhotoReorder markup (golden, pre-refactor)", () => {
  it("initial, covers, auto cover", async () => {
    expect((await show()).innerHTML).toMatchSnapshot();
  });
  it("auto cover badge and feedback", async () => {
    const c = await show({
      coverAuto: true,
      coverPhotoId: "a",
      mobileCoverId: null,
      actionData: { intent: "reorder", ok: false, stale: true, error: "boom" },
    });
    expect(c.innerHTML).toMatchSnapshot();
  });
  it("ok feedback", async () => {
    const c = await show({
      actionData: { intent: "reorder", ok: true, message: "Saved" },
    });
    expect(c.innerHTML).toMatchSnapshot();
  });
  it("keyboard select, move, escape, reset", async () => {
    const c = await show();
    press("a", "Enter");
    expect(c.innerHTML).toMatchSnapshot("selected");
    press("a", "ArrowRight");
    press("a", "End");
    expect(c.innerHTML).toMatchSnapshot("moved");
    press("a", "ArrowUp");
    press("a", "Home");
    press("a", "Escape");
    expect(c.innerHTML).toMatchSnapshot("deselected");
  });
  it("drag and drop (same set moves, other set ignored), quick sort", async () => {
    const c = await show();
    fireEvent.dragStart(tile("c"), { dataTransfer: dt });
    fireEvent.dragOver(tile("a"), { dataTransfer: dt });
    fireEvent.drop(tile("a"), { dataTransfer: dt });
    expect(c.innerHTML).toMatchSnapshot("dropped");
    fireEvent.dragStart(tile("c"), { dataTransfer: dt });
    fireEvent.dragOver(tile("d"), { dataTransfer: dt });
    fireEvent.drop(tile("d"), { dataTransfer: dt });
    fireEvent.dragEnd(tile("c"), { dataTransfer: dt });
    expect(c.innerHTML).toMatchSnapshot("cross-set ignored");
    fireEvent.click(screen.getAllByRole("button", { name: /nombre|name/i })[0]);
    expect(c.innerHTML).toMatchSnapshot("sorted by name");
    fireEvent.click(screen.getByRole("button", { name: "Restablecer" }));
    expect(c.innerHTML).toMatchSnapshot("reset");
  });
});
