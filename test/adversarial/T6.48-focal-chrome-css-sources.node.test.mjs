/**
 * T6.48 adversarial: the real-Chrome focal-drag test (T6.35) builds its
 * Tailwind CSS from a hard-coded list of source files. The refactor moved the
 * markup of those files into new files, so the Chrome test now runs against a
 * stylesheet that lacks many classes (origin-top-left, overflow-x-hidden,
 * @3xl:flex-row, lg:sticky, ...): it still passes, but no longer exercises the
 * production layout. Every utility class used by the components reachable
 * from the test's entry must be present in the listed sources.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const TEST = readFileSync(
  "test/adversarial/T6.35-focal-touch-drag.node.test.mjs",
  "utf8",
);
// T6.35 now builds its CSS from the whole app/components tree (sourcesOf), so
// the "listed" sources are every file under it, never a stale fixed list.
const globbed = /const srcs = sourcesOf\("app\/components"\)/.test(TEST);
const listed = globbed
  ? readdirSync("app/components", { recursive: true })
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => `app/components/${f}`)
  : [
      ...TEST.slice(TEST.indexOf("const srcs = [")).matchAll(/"(app\/[^"]+)"/g),
    ].map((m) => m[1]);

const tok = (s) => s.split(/[\s"'`<>{}=,;]+/).filter(Boolean);

describe("T6.35 Chrome focal test stylesheet", () => {
  it("builds from a directory glob, not a file list", () => {
    expect(globbed).toBe(true);
  });
  it("covers every class the five original files used before the T6.48 split", () => {
    const have = new Set(listed.flatMap((f) => tok(readFileSync(f, "utf8"))));
    // Captured from the five original components at 34d294f (before the split)
    // so the test does not need git history (CI checks out one commit).
    const before = JSON.parse(
      readFileSync("test/fixtures/focal-original-classes.json", "utf8"),
    );
    const missing = [...new Set(before)].filter((c) => !have.has(c));
    expect(missing).toEqual([]);
  });
});
