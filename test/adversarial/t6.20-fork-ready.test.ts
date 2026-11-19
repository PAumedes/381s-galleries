import { describe, expect, it } from "vitest";
import manifestRaw from "../../public/manifest.webmanifest?raw";
import { getStudioName } from "../../app/lib/server/admin";
import { DEFAULT_STUDIO_NAME } from "../../app/lib/default-studio-name";
import { hostConfigProblems } from "../support/wrangler-config";

const noDb = {
  prepare() {
    throw new Error("no db");
  },
} as unknown as D1Database;

const mk = (origin: string, legacy: string, routes: string[]) => ({
  routes: routes.map((pattern) => ({ pattern, custom_domain: true })),
  vars: { STUDIO_NAME: "Luz", PUBLIC_ORIGIN: origin, LEGACY_HOSTS: legacy },
});

describe("T6.20 adversarial", () => {
  it("whitespace-only env STUDIO_NAME falls back to the neutral default", async () => {
    const n = await getStudioName({ DB: noDb, STUDIO_NAME: "   " } as never);
    expect(n.trim()).not.toBe("");
    expect(n).toBe(DEFAULT_STUDIO_NAME);
  });

  it("generic static manifest linked from every page does not name the owner", () => {
    expect(manifestRaw).not.toMatch(/381/);
  });

  it("rejects an http PUBLIC_ORIGIN (runtime treats it as invalid)", () => {
    expect(
      hostConfigProblems(mk("http://luz.example", "", ["luz.example"])),
    ).not.toEqual([]);
  });

  it("rejects a PUBLIC_ORIGIN with a path", () => {
    expect(
      hostConfigProblems(mk("https://luz.example/sub", "", ["luz.example"])),
    ).not.toEqual([]);
  });

  it("rejects a legacy host equal to canonical differing only by case", () => {
    expect(
      hostConfigProblems(
        mk("https://luz.example", "LUZ.EXAMPLE", [
          "luz.example",
          "LUZ.EXAMPLE",
        ]),
      ),
    ).not.toEqual([]);
  });

  it("rejects duplicate LEGACY_HOSTS entries", () => {
    expect(
      hostConfigProblems(
        mk("https://luz.example", "a.example,a.example", [
          "luz.example",
          "a.example",
          "a.example",
        ]),
      ),
    ).not.toEqual([]);
  });

  it("accepts a legacy host whose case differs from its route (runtime is case-insensitive)", () => {
    expect(
      hostConfigProblems(
        mk("https://luz.example", "Vieja.Example", [
          "luz.example",
          "vieja.example",
        ]),
      ),
    ).toEqual([]);
  });

  it("reports a malformed PUBLIC_ORIGIN as a problem instead of throwing", () => {
    expect(() =>
      hostConfigProblems(mk("not a url", "", ["luz.example"])),
    ).not.toThrow();
  });
});
