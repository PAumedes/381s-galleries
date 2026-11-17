import { describe, expect, it } from "vitest";
import src from "../../app/components/DownloadMenu.tsx?raw";

// Token values copied from app/app.css ([data-theme] blocks); CSS ?raw is empty
// in the workers pool, so they are inlined here.
const PAPER_AND_GREY500: Record<string, [string, string]> = {
  claro: ["#fafaf8", "#7d7c77"],
  arena: ["#f4efe8", "#7b705f"],
  gris: ["#edeef0", "#6a707a"],
  oscuro: ["#0b0b0b", "#a3a29c"],
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
  it("DownloadMenu fieldset legends are real text in text-grey-500", () => {
    expect(src).toMatch(/<legend[^>]*text-grey-500/);
  });
  for (const [p, [paper, g500]] of Object.entries(PAPER_AND_GREY500)) {
    it(`${p}: text-grey-500 legend on paper >= 4.5`, () => {
      expect(ratio(g500, paper)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
