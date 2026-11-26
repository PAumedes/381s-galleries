import { describe, expect, it } from "vitest";
import {
  hasPreview,
  hasTiffOriginal,
  isTiffOnly,
  TIFF_MIME,
  tiffFilename,
} from "../app/lib/server/tiff";
import { resolveSource } from "../app/lib/server/image-source";
import type { SourcePhoto } from "../app/lib/server/image-source";

/** T6.53d: a TIFF is never an image source (no R2 cache, no warm, no /img). */
const photo = (over: Partial<SourcePhoto> = {}): SourcePhoto => ({
  id: "p1",
  driveHighresId: "HI",
  driveTiffId: null,
  driveWebId: "WEB",
  driveIgId: null,
  driveThumbId: "TH",
  driveWmId: "WM",
  driveThumbWmId: null,
  variantVersions: JSON.stringify({
    highres: "t1",
    web: "t2",
    thumb: "t3",
    wm: "t4",
    tiff: "t5",
  }),
  ...over,
});
const tiffOnly = (over: Partial<SourcePhoto> = {}) =>
  photo({ driveHighresId: "TIF", driveTiffId: "TIF", ...over });

describe("T6.53d tiff helpers", () => {
  it("TIFF-only = the TIFF id fills the high-res column; a JPEG high-res + TIFF is not TIFF-only", () => {
    expect(isTiffOnly(tiffOnly())).toBe(true);
    expect(isTiffOnly(photo({ driveTiffId: "TIF" }))).toBe(false);
    expect(isTiffOnly(photo())).toBe(false);
    expect(isTiffOnly({ driveHighresId: "A" })).toBe(false);
  });
  it("hasTiffOriginal", () => {
    expect(hasTiffOriginal(photo())).toBe(false);
    expect(hasTiffOriginal(photo({ driveTiffId: "X" }))).toBe(true);
    expect(hasTiffOriginal(photo({ driveTiffId: "" }))).toBe(false);
  });
  it("hasPreview: only a TIFF-only photo can lack one (delivery needs web, Prueba needs preview-wm)", () => {
    expect(
      hasPreview(photo({ driveWebId: null, driveThumbId: null }), false),
    ).toBe(true);
    expect(hasPreview(tiffOnly(), false)).toBe(true);
    expect(hasPreview(tiffOnly({ driveWebId: null }), false)).toBe(false);
    expect(hasPreview(tiffOnly({ driveWebId: "" }), false)).toBe(false);
    expect(hasPreview(tiffOnly({ driveWebId: null }), true)).toBe(true); // has WM
    expect(hasPreview(tiffOnly({ driveWmId: null }), true)).toBe(false);
  });
  it("tiffFilename: sanitized, `.tif`, never a path", () => {
    expect(tiffFilename("IMG_1")).toBe("IMG_1.tif");
    expect(tiffFilename('a/b\\c"d\r\n.x')).not.toMatch(/[/\\\r\n]/);
    expect(tiffFilename("")).toBe("photo.tif");
    expect(TIFF_MIME).toBe("image/tiff");
  });
});

describe("T6.53d resolveSource never returns the TIFF", () => {
  it.each([false, true])(
    "TIFF-only, no previews at all (proofing=%s): every variant is null",
    (proofing) => {
      const p = tiffOnly({
        driveWebId: null,
        driveThumbId: null,
        driveWmId: null,
      });
      for (const v of ["thumb", "view-sm", "view-lg"] as const)
        expect(resolveSource(p, proofing, v)).toBeNull();
    },
  );
  it("TIFF-only with a web JPEG: every delivery variant falls back to the web JPEG, not the TIFF", () => {
    const p = tiffOnly({ driveThumbId: null });
    for (const v of ["thumb", "view-sm", "view-lg"] as const)
      expect(resolveSource(p, false, v)).toMatchObject({
        fileId: "WEB",
        version: "t2",
      });
  });
  it("TIFF-only, thumb only: thumb works, the big ones are null", () => {
    const p = tiffOnly({ driveWebId: null });
    expect(resolveSource(p, false, "thumb")?.fileId).toBe("TH");
    expect(resolveSource(p, false, "view-sm")).toBeNull();
    expect(resolveSource(p, false, "view-lg")).toBeNull();
  });
  it("a JPEG high-res + TIFF behaves exactly as before (the JPEG is the source)", () => {
    const p = photo({
      driveTiffId: "TIF",
      driveWebId: null,
      driveThumbId: null,
    });
    expect(resolveSource(p, false, "view-lg")?.fileId).toBe("HI");
  });
  it("a photo without driveTiffId (older callers) behaves as before", () => {
    const { driveTiffId: _t, ...old } = photo();
    void _t;
    expect(
      resolveSource(old as unknown as SourcePhoto, false, "view-lg")?.fileId,
    ).toBe("HI");
  });
});
