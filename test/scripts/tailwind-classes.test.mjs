import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classesOf, css } from "../support/tailwind-css.mjs";

describe("test CSS helper (classesOf/css)", () => {
  it("keeps className tokens after an apostrophe in a comment or text", () => {
    const src = `// don't break
      <p>it's text</p>
      <div className="bg-grey-100 relative h-72 w-full md:h-80" />`;
    const found = classesOf([src]);
    for (const c of ["h-72", "w-full", "md:h-80", "relative"])
      expect(found).toContain(c);
  });

  it("generates the real utilities the focal picker box needs", async () => {
    const src = readFileSync("app/components/admin/FocalPicker.tsx", "utf8");
    const out = await css(classesOf([src]));
    expect(out).toContain(".h-72");
    expect(out).toContain(".md\\:h-80");
  });
});
