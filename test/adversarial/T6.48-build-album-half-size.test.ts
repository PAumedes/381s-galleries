/**
 * T6.48 adversarial: buildAlbum size fallback with a HALF-known high-res size
 * (width but no height / height 0) and sibling precedence. Passes on 34d294f
 * and on HEAD; kills mutants of sizeOfPhoto that the golden snapshot misses
 * (it only has "both missing" and "both present").
 */
import { describe, expect, it } from "vitest";
import {
  buildAlbum,
  type Located,
  type Recipe,
} from "../../app/lib/server/sync-helpers";
import type { DriveFile } from "../../app/lib/server/drive-types";

let n = 0;
const loc = (
  recipe: Recipe,
  name: string,
  over: Partial<DriveFile> = {},
): Located => ({
  recipe,
  set: "S",
  file: {
    id: `f${++n}`,
    name,
    mimeType: "image/jpeg",
    modifiedTime: "2026-01-01T00:00:00Z",
    ...over,
  },
});
const sizeOf = (located: Located[]) => {
  const { photos } = buildAlbum(
    { id: "root", name: "A", mimeType: "x" } as DriveFile,
    located,
    [],
    false,
  );
  return { width: photos[0].width, height: photos[0].height };
};

describe("buildAlbum photo size", () => {
  it("a high-res with only a width falls back to a sibling, never keeps a half size", () => {
    expect(
      sizeOf([
        loc("high-res", "a.jpg", { width: 6000 }),
        loc("web", "a.jpg", { width: 1200, height: 800 }),
      ]),
    ).toEqual({ width: 2048, height: 1365 });
  });

  it("a high-res with only a width and no sibling size is null/null", () => {
    expect(sizeOf([loc("high-res", "a.jpg", { width: 6000 })])).toEqual({
      width: null,
      height: null,
    });
  });

  it("the sibling order is web, ig, thumb, preview-wm, thumb-wm", () => {
    expect(
      sizeOf([
        loc("high-res", "a.jpg"),
        loc("thumb", "a.jpg", { width: 400, height: 400 }),
        loc("web", "a.jpg", { width: 3000, height: 1000 }),
      ]),
    ).toEqual({ width: 2048, height: 683 });
  });
});
