import { readFileSync } from "node:fs";
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
