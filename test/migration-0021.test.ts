import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { testMigrations } from "./support/d1";

const all = testMigrations();
const idx = all.findIndex((m) => m.name.startsWith("0021_"));
const run = (s: string, ...b: unknown[]) =>
  env.DB.prepare(s)
    .bind(...b)
    .run();

describe("migration 0021_client_pin (T6.52)", () => {
  it("is named 0021_client_pin.sql, right after 0020", () => {
    expect(all[idx]?.name).toBe("0021_client_pin.sql");
    expect(all[idx - 1]?.name).toBe("0020_clients.sql");
  });

  it("applies on a database with clients; they get pin_hash NULL", async () => {
    await applyD1Migrations(env.DB, all.slice(0, idx));
    await run("INSERT INTO clients (id, slug, name) VALUES ('c0', 'old', 'N')");
    await applyD1Migrations(env.DB, all);
    const c = await env.DB.prepare(
      "SELECT pin_hash FROM clients WHERE id = 'c0'",
    ).first<{ pin_hash: string | null }>();
    expect(c).toEqual({ pin_hash: null });
  });

  it("keeps the hand-written 0020 slug-namespace triggers and ON DELETE SET NULL", async () => {
    const names = (
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
      ).all<{ name: string }>()
    ).results.map((r) => r.name);
    for (const t of [
      "clients_slug_namespace_insert",
      "clients_slug_namespace_update",
      "galleries_slug_namespace_insert",
      "galleries_slug_namespace_update",
    ])
      expect(names).toContain(t);
    const fk = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'galleries'",
    ).first<{ sql: string }>();
    expect(fk!.sql).toMatch(/REFERENCES clients\(id\) ON DELETE SET NULL/);
  });
});
