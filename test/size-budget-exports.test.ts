import { describe, expect, it } from "vitest";
import * as galleries from "../app/lib/server/admin-galleries";

// T6.38: the facade keeps every name importers used before the split.
describe("T6.38 admin-galleries.ts public runtime exports", () => {
  it("exports the same names", () => {
    expect(Object.keys(galleries).sort()).toEqual(
      [
        "CLIENT_MAX",
        "PIN_MAX",
        "PIN_MIN",
        "REORDER_CHUNK",
        "SLUG_MAX",
        "TITLE_MAX",
        "countGalleries",
        "galleryAction",
        "isConstraintError",
        "listGalleries",
        "loadGalleryEdit",
        "photoSetVersion",
      ].sort(),
    );
  });
});
