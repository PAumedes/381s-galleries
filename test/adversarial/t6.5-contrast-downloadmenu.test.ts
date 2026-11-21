import { describe, expect, it } from "vitest";
import menu from "../../app/components/DownloadMenu.tsx?raw";
import bulkViews from "../../app/components/DownloadBulkViews.tsx?raw";

// The bulk screens (with the fieldset legends) live in DownloadBulkViews.
const src = menu + bulkViews;

// Token values copied from app/app.css ([data-theme] blocks); CSS ?raw is empty
// in the workers pool, so they are inlined here.
const PAPER_AND_GREY600: Record<string, [string, string]> = {
  claro: ["#fafaf8", "#615f5b"],
  arena: ["#f4efe8", "#5f5546"],
  gris: ["#edeef0", "#535962"],
  oscuro: ["#0b0b0b", "#c4c3be"],
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("T6.5 AA contrast of tokens actually used for text", () => {
  it("DownloadMenu fieldset legends are real text in text-grey-600 (not 500)", () => {
    expect(src).toMatch(/<legend[^>]*text-grey-600/);
    expect(src).not.toMatch(/<legend[^>]*text-grey-500/);
  });
  for (const [p, [paper, g600]] of Object.entries(PAPER_AND_GREY600)) {
    it(`${p}: text-grey-600 legend on paper >= 4.5`, () => {
      expect(ratio(g600, paper)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
