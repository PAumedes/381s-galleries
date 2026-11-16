import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("workers pool", () => {
  it("exposes configured bindings and vars", () => {
    expect(env.STUDIO_NAME).toBe("381 Studios");
    expect(env.DB).toBeDefined();
    expect(env.CACHE).toBeDefined();
  });
});
