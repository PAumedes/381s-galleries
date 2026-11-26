import { describe, expect, it } from "vitest";
import {
  buildAlbum,
  photoFields,
  recipeOf,
} from "../app/lib/server/sync-helpers";
import type {
  Located,
  Recipe,
  SyncIssue,
} from "../app/lib/server/sync-helpers";
import { buildVersionedAlbum } from "../app/lib/server/sync-versions";
import { FOLDER_MIME } from "../app/lib/server/drive-types";
import type { DriveFile } from "../app/lib/server/drive-types";

/** T6.53d: `.tif/.tiff` files are the photo's original (high-res slot); a JPEG with the same base name is the preview. */
let n = 0;
const file = (name: string, over: Partial<DriveFile> = {}): DriveFile => ({
  id: `f${String(++n).padStart(3, "0")}`,
  name,
  mimeType: "image/jpeg",
  modifiedTime: "2026-01-01T00:00:00Z",
  width: 2000,
  height: 1000,
  size: 500,
  ...over,
});
const loc = (
  recipe: Recipe,
  name: string,
  over: Partial<DriveFile> = {},
): Located => ({ recipe, set: "Highlights", file: file(name, over) });
const tif = (recipe: Recipe, name: string, over: Partial<DriveFile> = {}) =>
  loc(recipe, name, { mimeType: "image/tiff", size: 300_000_000, ...over });
const FOLDER = file("Album", { mimeType: FOLDER_MIME });
const build = (located: Located[]) => buildAlbum(FOLDER, located, [], false);
const types = (issues: SyncIssue[]) => issues.map((i) => i.type);

describe("T6.53d sync: TIFF originals", () => {
  it("the `tiff` folder is a recipe folder, any case (never an unknown folder)", () => {
    expect(recipeOf("tiff")).toBe("tiff");
    expect(recipeOf("TIFF")).toBe("tiff");
    expect(recipeOf(" Tiff ")).toBe("tiff");
  });

  it("a TIFF in tiff/ alone is a photo whose original is the TIFF (no missing_highres)", () => {
    const t = tif("tiff", "IMG_1.tif");
    const a = build([t]);
    expect(a.photos).toHaveLength(1);
    const p = a.photos[0];
    expect(p.highres.id).toBe(t.file.id);
    expect(p.tiff?.id).toBe(t.file.id);
    expect(p.web).toBeUndefined();
    expect(types(a.issues)).not.toContain("missing_highres");
    expect(types(a.issues)).not.toContain("not_jpeg");
  });

  it.each([
    ["IMG.TIF", "application/octet-stream"],
    ["IMG.tiff", "application/octet-stream"],
    ["IMG.TiFf", "image/tiff"],
    ["IMG.tif", "image/tiff"],
  ])(
    "%s (%s) in tiff/ or high-res/ is accepted by extension, case-insensitive",
    (name, mimeType) => {
      for (const recipe of ["tiff", "high-res"] as const) {
        const a = build([tif(recipe, name, { mimeType })]);
        expect(a.photos).toHaveLength(1);
        expect(a.photos[0].tiff).toBeDefined();
        expect(a.issues).not.toContainEqual(
          expect.objectContaining({ type: "not_jpeg" }),
        );
      }
    },
  );

  it("a TIFF named .jpg (JPEG mime) is still a JPEG, and a .tif in web/ stays not_jpeg", () => {
    const a = build([
      loc("high-res", "A.jpg"),
      tif("web", "A.tif"),
      tif("thumb", "A.tiff"),
    ]);
    expect(a.photos[0].tiff).toBeUndefined();
    expect(a.issues.filter((i) => i.type === "not_jpeg")).toHaveLength(2);
  });

  it("a non-TIFF in tiff/ (a JPEG, a PNG) is a not_jpeg issue and makes no photo", () => {
    const a = build([loc("tiff", "A.jpg"), loc("tiff", "B.png")]);
    expect(a.photos).toHaveLength(0);
    expect(a.issues.filter((i) => i.type === "not_jpeg")).toHaveLength(2);
  });

  it("TIFF + web/thumb JPEGs of the same base name: the JPEGs are the previews, size comes from them (never from the TIFF)", () => {
    const t = tif("tiff", "IMG_1.tif", { width: 9000, height: 6000 });
    const web = loc("web", "IMG_1.jpg", { width: 2048, height: 1365 });
    const thumb = loc("thumb", "IMG_1.jpg");
    const p = build([t, web, thumb]).photos[0];
    expect(p.highres.id).toBe(t.file.id);
    expect(p.web?.id).toBe(web.file.id);
    expect(p.thumb?.id).toBe(thumb.file.id);
    expect({ w: p.width, h: p.height }).toEqual({ w: 2048, h: 1365 });
  });

  it("a TIFF-only photo has no dimensions, even when Drive reports some for the TIFF", () => {
    const p = build([tif("tiff", "IMG_1.tif", { width: 9000, height: 6000 })])
      .photos[0];
    expect({ w: p.width, h: p.height }).toEqual({ w: null, h: null });
  });

  it("TIFF + a JPEG high-res of the same base name: the JPEG stays the high-res file, the TIFF is the original download", () => {
    const hr = loc("high-res", "IMG_1.jpg");
    const t = tif("tiff", "IMG_1.tif");
    const p = build([hr, t]).photos[0];
    expect(p.highres.id).toBe(hr.file.id);
    expect(p.tiff?.id).toBe(t.file.id);
  });

  it("two TIFFs with the same base name: newest wins, `duplicate` is reported", () => {
    const old = tif("tiff", "A.tif", { modifiedTime: "2026-01-01T00:00:00Z" });
    const neu = tif("high-res", "A.TIF", {
      modifiedTime: "2026-02-01T00:00:00Z",
    });
    const a = build([old, neu]);
    expect(a.photos).toHaveLength(1);
    expect(a.photos[0].tiff?.id).toBe(neu.file.id);
    expect(types(a.issues)).toContain("duplicate");
  });

  it("a TIFF in another set stays in that set", () => {
    const a = build([
      { ...tif("tiff", "A.tif"), set: "Ceremonia" },
      { ...loc("web", "A.jpg"), set: "Fiesta" },
    ]);
    expect(a.photos.map((p) => p.setName)).toEqual(["Ceremonia"]);
    expect(types(a.issues)).toContain("missing_highres");
  });
});

describe("T6.53d photos columns", () => {
  it("TIFF-only: driveHighresId and driveTiffId hold the same id; highresBytes is the TIFF's size", () => {
    const t = tif("tiff", "A.tif", { size: 312_000_000 });
    const f = photoFields(build([t]).photos[0]);
    expect(f.driveHighresId).toBe(t.file.id);
    expect(f.driveTiffId).toBe(t.file.id);
    expect(f.highresBytes).toBe(312_000_000);
    expect(JSON.parse(f.variantVersions).tiff).toBe(t.file.modifiedTime);
  });

  it("TIFF + JPEG high-res: both ids, bytes of the TIFF (what the download serves)", () => {
    const hr = loc("high-res", "A.jpg", { size: 4_000_000 });
    const t = tif("tiff", "A.tif", { size: 90_000_000 });
    const f = photoFields(build([hr, t]).photos[0]);
    expect(f.driveHighresId).toBe(hr.file.id);
    expect(f.driveTiffId).toBe(t.file.id);
    expect(f.highresBytes).toBe(90_000_000);
  });

  it("a photo without TIFF: null id and the variant_versions JSON has no `tiff` key (byte for byte as before)", () => {
    const f = photoFields(build([loc("high-res", "A.jpg")]).photos[0]);
    expect(f.driveTiffId).toBeNull();
    expect(Object.keys(JSON.parse(f.variantVersions))).toEqual([
      "highres",
      "web",
      "ig",
      "thumb",
      "wm",
      "thumbWm",
    ]);
  });
});

describe("T6.53d versioned albums", () => {
  it("`IMG_v2.tif` is version 2 of IMG; v1 stays the JPEG (the TIFF becomes the latest original)", () => {
    const a = buildVersionedAlbum(
      FOLDER,
      [
        loc("high-res", "IMG.jpg"),
        loc("web", "IMG.jpg"),
        tif("tiff", "IMG_v2.tif"),
        loc("web", "IMG_v2.jpg"),
      ],
      [],
      false,
    );
    expect(a.photos).toHaveLength(1);
    const p = a.photos[0];
    expect(p.versions?.map((v) => v.version)).toEqual([1, 2]);
    expect(p.versions?.[0].draft.tiff).toBeUndefined();
    expect(p.tiff?.name).toBe("IMG_v2.tif");
    expect(p.highres.name).toBe("IMG_v2.tif");
  });
});
