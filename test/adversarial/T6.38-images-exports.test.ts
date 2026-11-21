import { describe, expect, it } from "vitest";
import * as images from "../../app/lib/server/images";

describe("T6.38 images.ts keeps its pre-refactor public exports", () => {
  it("still exports VARIANTS (['thumb','view-sm','view-lg'])", () => {
    expect((images as Record<string, unknown>).VARIANTS).toEqual([
      "thumb",
      "view-sm",
      "view-lg",
    ]);
  });
});
