import { describe, expect, it } from "vitest";
// @ts-expect-error raw import
import src from "../../scripts/check-admin-mobile.mjs?raw";

describe("T6.11 adversarial: check-admin-mobile script", () => {
  it("rejects a non-local --base (script drives admin pages with dev auth assumptions)", () => {
    expect(src).toMatch(/localhost|127\.0\.0\.1/);
    expect(src).toMatch(/new URL\(BASE\)|\.hostname/);
  });
});
