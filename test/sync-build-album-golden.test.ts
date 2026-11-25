import { describe, expect, it } from "vitest";
import {
  buildAlbum,
  type Located,
  type Recipe,
  type SyncIssue,
} from "../app/lib/server/sync-helpers";
import type { DriveFile } from "../app/lib/server/drive-types";

let n = 0;
const file = (name: string, over: Partial<DriveFile> = {}): DriveFile => ({
  id: `f${String(++n).padStart(2, "0")}`,
  name,
  mimeType: "image/jpeg",
  modifiedTime: "2026-01-01T00:00:00Z",
  ...over,
});
const loc = (
  recipe: Recipe,
  set: string,
  name: string,
  over: Partial<DriveFile> = {},
): Located => ({ recipe, set, file: file(name, over) });

describe("T6.48 buildAlbum (golden, pre-refactor)", () => {
  it("full recipe sets, fallback dimensions, issues, duplicates, case folding", () => {
    n = 0;
    const issues: SyncIssue[] = [
      { type: "stray_file", set: null, name: "x.txt" },
    ];
    const located: Located[] = [
      loc("high-res", "Highlights", "IMG_1.jpg", { width: 6000, height: 4000 }),
      loc("web", "Highlights", "IMG_1.jpg"),
      loc("ig", "Highlights", "img_1.JPG"),
      loc("thumb", "Highlights", "IMG_1.jpg"),
      loc("preview-wm", "Highlights", "IMG_1.jpg"),
      loc("thumb-wm", "Highlights", "IMG_1.jpg"),
      // no dimensions on the high-res: derived from the web file
      loc("high-res", "Fiesta", "IMG_2.jpg"),
      loc("web", "Fiesta", "IMG_2.jpg", { width: 1200, height: 800 }),
      loc("thumb", "Fiesta", "IMG_2.jpg", { width: 600, height: 400 }),
      // no dimensions anywhere, missing web and thumb
      loc("high-res", "Fiesta", "IMG_3.jpg"),
      // duplicate: newest wins, tie broken by id
      loc("high-res", "Fiesta", "IMG_4.jpg", {
        modifiedTime: "2026-01-01T00:00:00Z",
      }),
      loc("high-res", "fiesta", "img_4.jpg", {
        modifiedTime: "2026-02-01T00:00:00Z",
      }),
      loc("web", "Fiesta", "IMG_4.jpg"),
      loc("thumb", "Fiesta", "IMG_4.jpg"),
      // not a jpeg (and one named .jpeg by extension only)
      loc("web", "Fiesta", "IMG_5.png", { mimeType: "image/png" }),
      loc("high-res", "Fiesta", "IMG_6.jpeg", {
        mimeType: "application/octet-stream",
      }),
      loc("web", "Fiesta", "IMG_6.jpeg", {
        mimeType: "application/octet-stream",
      }),
      loc("thumb", "Fiesta", "IMG_6.jpeg", {
        mimeType: "application/octet-stream",
      }),
      // derived recipes with no high-res
      loc("web", "Highlights", "ORPHAN.jpg"),
      loc("ig", "Fiesta", "ORPHAN2.jpg"),
      loc("thumb-wm", "Fiesta", "ORPHAN2.jpg"),
      // unicode normalisation: NFD name matches NFC name
      loc("high-res", "Highlights", "Café.jpg", { width: 3000, height: 2000 }),
      loc("web", "Highlights", "Café.jpg"),
      loc("thumb", "Highlights", "Café.jpg"),
    ];
    const album = buildAlbum(
      file("Album", { mimeType: "application/vnd.google-apps.folder" }),
      located,
      issues,
      true,
    );
    expect(album).toMatchSnapshot();
    // the caller's issue list is appended to (not copied)
    expect(issues.length).toBeGreaterThan(1);
  });
  it("empty album", () => {
    expect(buildAlbum(file("E"), [], [], false)).toMatchSnapshot();
  });
  describe("photo size fallback (half-known high-res, sibling precedence)", () => {
    const sizeOf = (located: Located[]) => {
      const { photos } = buildAlbum(file("A"), located, [], false);
      return { width: photos[0].width, height: photos[0].height };
    };
    it("a high-res with only a width falls back to a sibling, never a half size", () => {
      expect(
        sizeOf([
          loc("high-res", "S", "a.jpg", { width: 6000 }),
          loc("web", "S", "a.jpg", { width: 1200, height: 800 }),
        ]),
      ).toEqual({ width: 2048, height: 1365 });
    });
    it("a high-res with only a width and no sibling size is null/null", () => {
      expect(sizeOf([loc("high-res", "S", "a.jpg", { width: 6000 })])).toEqual({
        width: null,
        height: null,
      });
    });
    it("the sibling order is web before thumb", () => {
      expect(
        sizeOf([
          loc("high-res", "S", "a.jpg"),
          loc("thumb", "S", "a.jpg", { width: 400, height: 400 }),
          loc("web", "S", "a.jpg", { width: 3000, height: 1000 }),
        ]),
      ).toEqual({ width: 2048, height: 683 });
    });
  });
});
