import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, slugify, uniqueSlug } from "../app/lib/server/slug";

describe("RESERVED_SLUGS", () => {
  it("matches PLAN section 2 exactly", () => {
    expect([...RESERVED_SLUGS]).toEqual([
      "admin",
      "api",
      "img",
      "dl",
      "assets",
      "brand",
      "favicon.ico",
      "robots.txt",
      "manifest.webmanifest",
    ]);
  });
});

describe("slugify / uniqueSlug", () => {
  it("strips accents and punctuation", () => {
    expect(slugify("Boda Ana & Luís!")).toBe("boda-ana-luis");
    expect(slugify("???")).toBe("galeria");
  });
  it("suffixes reserved and taken slugs with -2, -3", () => {
    const taken = new Set<string>();
    expect(uniqueSlug("Admin", taken)).toBe("admin-2");
    expect(uniqueSlug("Admin", taken)).toBe("admin-3");
    expect(uniqueSlug("API", taken)).toBe("api-2");
    expect(taken.has("admin-2")).toBe(true);
  });
});
