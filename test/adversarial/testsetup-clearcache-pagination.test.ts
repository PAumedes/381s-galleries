import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { clearCache } from "../support/cache";
describe("clearCache", () => {
  it("deletes more than 1000 objects", async () => {
    for (let i = 0; i < 1005; i++) await env.CACHE.put(`k/${i}`, "x");
    await clearCache();
    expect((await env.CACHE.list()).objects.length).toBe(0);
  }, 60000);
});
