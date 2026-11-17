import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PALETTES, PALETTE_COLORS } from "../../app/lib/design";

const css = readFileSync(path.resolve("app/app.css"), "utf8");

/** Token values per palette, parsed from the real app.css. */
function tokens(palette: string): Record<string, string> {
  const re = new RegExp(`\\[data-theme="${palette}"\\][^{]*\\{([^}]*)\\}`, "g");
  const out: Record<string, string> = {};
  for (const m of css.matchAll(re))
    for (const d of m[1].matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g))
      out[d[1]] = d[2].toLowerCase();
  return out;
}
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

describe.each(PALETTES)("palette %s", (p) => {
  const t = tokens(p);
  it("defines the full token set", () => {
    for (const k of [
      "paper",
      "ink",
      ...[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map(
        (n) => `grey-${n}`,
      ),
    ])
      expect(t[k], `${p} ${k}`).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("every text pair meets WCAG AA (>= 4.5)", () => {
    const text = ["ink", "grey-900", "grey-800", "grey-700", "grey-600"];
    const bg = ["paper", "grey-50"];
    for (const f of text)
      for (const b of bg)
        expect(ratio(t[f], t[b]), `${p}: ${f} on ${b}`).toBeGreaterThanOrEqual(
          4.5,
        );
    // inverted controls: paper text on ink / grey-800 buttons
    expect(ratio(t.paper, t.ink)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t.paper, t["grey-800"])).toBeGreaterThanOrEqual(4.5);
  });
  it("non-text UI (grey-500 icons, grey-300 borders on paper) >= 3 / present", () => {
    expect(ratio(t["grey-500"], t.paper)).toBeGreaterThanOrEqual(3);
  });
  it("PWA theme-color equals the palette background", () => {
    expect(PALETTE_COLORS[p].toLowerCase()).toBe(t.paper);
  });
});

describe("palette identity", () => {
  it("Arena is warm off-white F4EFE8, Gris is cool grey EDEEF0", () => {
    expect(tokens("arena").paper).toBe("#f4efe8");
    expect(tokens("gris").paper).toBe("#edeef0");
  });
  it("html/body follow the page palette (no flash of light behind dark)", () => {
    expect(css).toMatch(/html:has\(\[data-page\]\[data-theme="oscuro"\]\)/);
    expect(css).toMatch(/html:has\(\[data-page\]\[data-theme="arena"\]\)/);
    expect(css).toMatch(/html:has\(\[data-page\]\[data-theme="gris"\]\)/);
  });
  it("cover overlay is defined per palette (warm for Arena)", () => {
    expect(css).toMatch(/\[data-theme="arena"\][^{]*\{[^}]*--cover-scrim/);
  });
});
