/**
 * T6.48 guard: Chrome tests must build their Tailwind CSS from a directory
 * glob (sourcesOf), never from a list of individual app/components files that
 * goes stale when markup moves.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = ["test/adversarial", "test/support", "test/scripts"].flatMap(
  (d) =>
    readdirSync(d)
      .filter((f) => /\.(mjs|tsx?)$/.test(f))
      .map((f) => `${d}/${f}`),
);

describe("T6.48 Chrome CSS sources", () => {
  it("no test feeds a file list of app/components to the CSS builder", () => {
    const bad = files.filter((f) => {
      if (f.includes("T6.48-")) return false;
      const src = readFileSync(f, "utf8");
      return /\[\s*"app\/components\/[^\]]*\]\s*\.map\(/.test(src);
    });
    expect(bad).toEqual([]);
  });
});
