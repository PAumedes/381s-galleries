import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_STUDIO_NAME } from "../../app/lib/default-studio-name";

const pub = (p: string) => path.join(process.cwd(), "public", p);
const dims = (p: string) => {
  const b = readFileSync(pub(p));
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

describe("PWA static assets", () => {
  it("icons exist with the right sizes", () => {
    expect(dims("icons/icon-192.png")).toEqual([192, 192]);
    expect(dims("icons/icon-512.png")).toEqual([512, 512]);
    expect(dims("icons/maskable-512.png")).toEqual([512, 512]);
  });

  it("generic manifest is the studio one rooted at /", () => {
    const m = JSON.parse(readFileSync(pub("manifest.webmanifest"), "utf8"));
    expect(m).toMatchObject({
      name: DEFAULT_STUDIO_NAME,
      start_url: "/",
      display: "standalone",
      background_color: "#FAFAF8",
    });
    expect(m.scope).toBeUndefined();
    expect(m.short_name.length).toBeLessThanOrEqual(12);
    expect(m.icons.map((i: { src: string }) => i.src)).toEqual([
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/maskable-512.png",
    ]);
  });
});

describe("T6.22 shipped assets", () => {
  it("public/brand has no logo SVGs (wordmark default); neutral set is not served", () => {
    for (const f of ["brand/logo-black.svg", "brand/logo-white.svg"])
      expect(existsSync(pub(f))).toBe(false);
    expect(existsSync(path.join(process.cwd(), "brand-owner"))).toBe(false);
    expect(existsSync(pub("../brand-neutral/icons/icon-512.png"))).toBe(true);
    expect(existsSync(pub("brand-neutral"))).toBe(false);
  });
  it("apple icon is 180px, favicons are a valid ico and svg", () => {
    expect(dims("apple-touch-icon.png")).toEqual([180, 180]);
    const ico = readFileSync(pub("favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    expect(readFileSync(pub("favicon.svg"), "utf8")).toMatch(/<svg[\s>]/);
  });
});
