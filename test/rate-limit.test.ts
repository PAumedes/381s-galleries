import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  hit,
  retryAfterFor,
  type RateRule,
} from "../app/lib/server/rate-limit";

const RULE: RateRule = { scope: "t", max: 2, windowMs: 600_000 };

describe("RateRule helpers (T6.32)", () => {
  beforeAll(migrateDb);
  beforeEach(() => resetTables("rate_limits"));

  it("hit allows max hits per key, then refuses; keys are independent", async () => {
    expect(await hit(env, RULE, "a")).toBe(true);
    expect(await hit(env, RULE, "a")).toBe(true);
    expect(await hit(env, RULE, "a")).toBe(false);
    expect(await hit(env, RULE, "b")).toBe(true);
    const row = await env.DB.prepare(
      "SELECT count FROM rate_limits WHERE key = 't:a'",
    ).first<{ count: number }>();
    expect(row?.count).toBe(3);
  });

  it("a per-key window overrides the rule's", async () => {
    await env.DB.prepare(
      "INSERT INTO rate_limits (key, count, window_start) VALUES ('t:old', 9, ?1)",
    )
      .bind(new Date(Date.now() - 5_000).toISOString())
      .run();
    expect(await hit(env, RULE, "old", 1_000)).toBe(true);
  });

  it("retryAfterFor is whole seconds within the window, default window from the rule", async () => {
    await hit(env, RULE, "a");
    const s = await retryAfterFor(env, RULE, "a");
    expect(s).toBeGreaterThan(595);
    expect(s).toBeLessThanOrEqual(600);
    expect(await retryAfterFor(env, RULE, "a", 30_000)).toBeLessThanOrEqual(30);
  });
});
