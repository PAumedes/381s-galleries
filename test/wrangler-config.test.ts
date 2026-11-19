import { describe, expect, it } from "vitest";
import { parseWrangler } from "./support/wrangler-config";

describe("T6.20 parseWrangler (JSONC)", () => {
  it("handles trailing comments, block comments and trailing commas", () => {
    const c = parseWrangler(`{
      // line
      "routes": [ { "pattern": "a.example", "custom_domain": true, }, ], /* x */
      "vars": { "PUBLIC_ORIGIN": "https://a.example", // trailing
        "STUDIO_NAME": "N", },
    }`);
    expect(c.routes[0].pattern).toBe("a.example");
    expect(c.vars.STUDIO_NAME).toBe("N");
  });
  it("does not corrupt comment markers or ,} inside strings", () => {
    const c = parseWrangler(
      `{"routes":[],"vars":{"STUDIO_NAME":"a,} // b /* c */ \\" ,]","PUBLIC_ORIGIN":"https://x"}}`,
    );
    expect(c.vars.STUDIO_NAME).toBe('a,} // b /* c */ " ,]');
  });
  it("block comment mid-line and comment between comma and bracket", () => {
    const c = parseWrangler(
      `{"routes":[ /* a */ ], "vars":{"STUDIO_NAME":"x", // c\n /* d */ }}`,
    );
    expect(c.vars.STUDIO_NAME).toBe("x");
  });
});
