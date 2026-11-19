import { render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Mutation coverage of the gallery-edit/ split: what the tab components hand
 * to the preview, cover editor and photo grid. Those children are replaced by
 * recorders so the props themselves are asserted.
 */

const lp = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));
const cp = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));
const pr = vi.hoisted(() => ({
  mounts: 0,
  calls: [] as Record<string, unknown>[],
}));

vi.mock("../../app/components/admin/LivePreview", async (orig) => ({
  ...(await orig<object>()),
  LivePreview: (p: Record<string, unknown>) => {
    lp.calls.push(p);
    return null;
  },
}));
vi.mock("../../app/components/admin/CoverPreview", () => ({
  CoverPreview: (p: Record<string, unknown>) => {
    cp.calls.push(p);
    return null;
  },
}));
vi.mock("../../app/components/admin/PhotoReorder", () => ({
  PhotoReorder: (p: Record<string, unknown>) => {
    pr.calls.push(p);
    useEffect(() => {
      pr.mounts++;
    }, []);
    return null;
  },
}));
vi.mock("../../app/i18n/use-t", () => ({
  useT: () => (k: string) => k,
  useLang: () => "es",
}));

import { CoverTab } from "../../app/components/admin/gallery-edit/CoverTab";
import { EditorPreview } from "../../app/components/admin/gallery-edit/EditorPreview";
import { PhotosTab } from "../../app/components/admin/gallery-edit/PhotosTab";
import type {
  EditorCover,
  PreviewState,
} from "../../app/components/admin/gallery-edit/types";

afterEach(() => {
  lp.calls = [];
  cp.calls = [];
  pr.calls = [];
  pr.mounts = 0;
});

const photos = [
  { id: "p1", set: "A", name: "1", width: 3000, height: 2000, takenAt: null },
  { id: "p2", set: "A", name: "2", width: 1000, height: 2000, takenAt: null },
] as never;
const design = {
  palette: "claro",
  coverLayout: "completa",
  gridStyle: "filas",
  gridGap: "normal",
} as const;
const state = (o: Partial<PreviewState> = {}): PreviewState => ({
  title: "T",
  eventDate: "2026-11-01",
  design: design as never,
  proofing: false,
  versions: {},
  device: "desktop",
  onDevice: () => {},
  ...o,
});
const p1 = (photos as { id: string }[])[0] as never;
const p2 = (photos as { id: string }[])[1] as never;
const cover = (o: Partial<EditorCover> = {}): EditorCover => ({
  coverId: "p1",
  coverPhoto: p1,
  mobilePhoto: undefined,
  ...o,
});
const gal = (o: object = {}) =>
  ({
    coverPhotoId: "p1",
    coverPhotoIdMobile: null,
    coverFocus: null,
    ...o,
  }) as never;
const last = (c: Record<string, unknown>[]) => c[c.length - 1]!;

describe("gallery editor mutants: EditorPreview props", () => {
  const show = (g: object, s: PreviewState, c: EditorCover) =>
    render(
      <EditorPreview
        g={gal(g)}
        photos={photos}
        cover={c}
        state={s}
        heading="h"
        hint="i"
      />,
    );

  it("an empty event date reaches the preview as null, a set one as is", () => {
    show({}, state({ eventDate: "" }), cover());
    expect(last(lp.calls).eventDate).toBeNull();
    show({}, state({ eventDate: "2026-11-01" }), cover());
    expect(last(lp.calls).eventDate).toBe("2026-11-01");
  });

  it("mobile cover: own photo, its aspect and its focus (null when unset)", () => {
    show(
      { coverFocusMobile: { x: 10, y: 90 } },
      state(),
      cover({ mobilePhoto: p2 }),
    );
    expect(last(lp.calls).mobileCover).toEqual({
      id: "p2",
      aspect: 0.5,
      focus: { x: 10, y: 90 },
    });
    show({}, state(), cover({ mobilePhoto: p2 }));
    expect(last(lp.calls).mobileCover).toEqual({
      id: "p2",
      aspect: 0.5,
      focus: null,
    });
    show({}, state(), cover());
    expect(last(lp.calls).mobileCover).toBeNull();
  });

  it("desktop cover: id, aspect and the saved focus", () => {
    show({ coverFocus: { x: 1, y: 2 } }, state(), cover());
    expect(last(lp.calls).cover).toEqual({
      id: "p1",
      aspect: 1.5,
      focus: { x: 1, y: 2 },
    });
    show({}, state(), cover({ coverId: null, coverPhoto: undefined }));
    expect(last(lp.calls).cover).toBeNull();
  });
});

describe("gallery editor mutants: CoverTab props", () => {
  const show = (g: object, c: EditorCover, s = state()) =>
    render(
      <CoverTab
        g={gal(g)}
        photos={photos}
        cover={c}
        state={s}
        actionData={undefined}
      />,
    );

  it("coverAuto is true exactly when no cover was chosen", () => {
    show({ coverPhotoId: null }, cover());
    expect(last(cp.calls).coverAuto).toBe(true);
    show({ coverPhotoId: "p1" }, cover());
    expect(last(cp.calls).coverAuto).toBe(false);
  });

  it("the cover photo's pixel size is passed for the focal aspect (null when unknown)", () => {
    show({}, cover());
    expect(last(cp.calls)).toMatchObject({
      coverWidth: 3000,
      coverHeight: 2000,
    });
    show({}, cover({ coverPhoto: undefined }));
    expect(last(cp.calls)).toMatchObject({
      coverWidth: null,
      coverHeight: null,
    });
    show(
      {},
      cover({ coverPhoto: { id: "p1", width: null, height: null } as never }),
    );
    expect(last(cp.calls)).toMatchObject({
      coverWidth: null,
      coverHeight: null,
    });
  });

  it("mobile cover carries its size and focus; the empty date goes as null", () => {
    show(
      { coverFocusMobile: { x: 5, y: 6 }, mobileCoverNoWm: true },
      cover({ mobilePhoto: p2 }),
      state({ eventDate: "" }),
    );
    const p = last(cp.calls);
    expect(p.mobileCover).toEqual({
      id: "p2",
      width: 1000,
      height: 2000,
      focus: { x: 5, y: 6 },
    });
    expect(p.mobileNoWm).toBe(true);
    expect(p.eventDate).toBeNull();
    expect(p.initialFocus).toBeNull();
  });
});

describe("gallery editor mutants: PhotosTab", () => {
  const data = (ids: string[]) =>
    ({
      photos: ids.map((id) => ({ id, set: "A", name: id, takenAt: null })),
      version: "v1",
      issues: { groups: [], truncated: 0, total: 0 },
    }) as never;
  const tab = (ids: string[]) => (
    <PhotosTab data={data(ids)} g={gal()} coverId="p1" actionData={undefined} />
  );

  it("the reorder grid remounts (state reset) when the photo set changes, not on a plain rerender", () => {
    const { rerender } = render(tab(["p1", "p2"]));
    expect(pr.mounts).toBe(1);
    rerender(tab(["p1", "p2"]));
    expect(pr.mounts).toBe(1);
    rerender(tab(["p2", "p1"]));
    expect(pr.mounts).toBe(2);
    rerender(tab(["p1", "p2", "p3"]));
    expect(pr.mounts).toBe(3);
  });
});
