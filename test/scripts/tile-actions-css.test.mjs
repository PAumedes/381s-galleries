import process from "node:process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { compile } from "tailwindcss";

const require = createRequire(import.meta.url);
const TILE_ACTIONS = readFileSync(
  "app/components/admin/TileActions.tsx",
  "utf8",
);

async function css(candidates) {
  const c = await compile('@import "tailwindcss";', {
    base: process.cwd(),
    loadStylesheet: async (id, base) => {
      const path = id === "tailwindcss" ? "tailwindcss/index.css" : id;
      const file = path.startsWith(".")
        ? require.resolve(path, { paths: [base] })
        : require.resolve(path, { paths: [process.cwd()] });
      return { path: file, base, content: readFileSync(file, "utf8") };
    },
  });
  return c.build(candidates);
}

describe("T6.18 tile actions narrow-tile CSS", () => {
  it("generates the container query that restacks below 3 x 44px + gaps (140px)", async () => {
    const bp = /@max-\[(\d+(?:\.\d+)?)rem\]:grid-cols-1/.exec(TILE_ACTIONS);
    expect(bp).not.toBeNull();
    const rem = Number(bp[1]);
    expect(rem * 16).toBeGreaterThanOrEqual(140);
    const out = await css([
      `@max-[${bp[1]}rem]:grid-cols-1`,
      `@max-[${bp[1]}rem]:flex-row`,
    ]);
    expect(out).toMatch(
      new RegExp(`@container \\(width <?=?\\s*${bp[1]}rem\\)`),
    );
    expect(out).toContain("grid-template-columns: repeat(1");
  });
});
