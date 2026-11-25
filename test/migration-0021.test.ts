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

  it("keeps existing clients and albums intact; epoch starts at 0 and cannot be NULL", async () => {
    await run("DELETE FROM galleries");
    await run("DELETE FROM clients");
    await run(
      "INSERT INTO clients (id, slug, name, default_show_on_home) VALUES ('c1', 'acme', 'Acme', 1), ('c2', 'beta', 'Beta', 0)",
    );
    await run(
      "INSERT INTO galleries (id, drive_folder_id, slug, title, status, client_id, show_on_home, pin_hash) VALUES ('g1', 'f1', 'boda', 'Boda', 'published', 'c1', 1, NULL), ('g2', 'f2', 'xv', 'XV', 'published', 'c1', 0, 'h'), ('g3', 'f3', 'solo', 'Solo', 'draft', NULL, 0, NULL)",
    );
    await applyD1Migrations(env.DB, all);
    const clients = await env.DB.prepare(
      "SELECT id, slug, name, default_show_on_home d, pin_hash, pin_epoch FROM clients ORDER BY id",
    ).all();
    expect(clients.results).toEqual([
      {
        id: "c1",
        slug: "acme",
        name: "Acme",
        d: 1,
        pin_hash: null,
        pin_epoch: 0,
      },
      {
        id: "c2",
        slug: "beta",
        name: "Beta",
        d: 0,
        pin_hash: null,
        pin_epoch: 0,
      },
    ]);
    const g = await env.DB.prepare(
      "SELECT id, client_id, show_on_home h, pin_hash FROM galleries ORDER BY id",
    ).all();
    expect(g.results).toEqual([
      { id: "g1", client_id: "c1", h: 1, pin_hash: null },
      { id: "g2", client_id: "c1", h: 0, pin_hash: "h" },
      { id: "g3", client_id: null, h: 0, pin_hash: null },
    ]);
    await expect(
      run("UPDATE clients SET pin_epoch = NULL WHERE id = 'c1'"),
    ).rejects.toThrow();
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

describe("migration 0021 pin_epoch trigger (T6.52)", () => {
  it("bumps pin_epoch only when pin_hash really changes, whoever writes it", async () => {
    await run("DELETE FROM galleries");
    await run("DELETE FROM clients");
    await run(
      "INSERT INTO clients (id, slug, name) VALUES ('c1', 'acme', 'N')",
    );
    const epoch = async () =>
      (await env.DB.prepare(
        "SELECT pin_epoch n FROM clients WHERE id = 'c1'",
      ).first<{
        n: number;
      }>())!.n;
    await run("UPDATE clients SET name = 'M' WHERE id = 'c1'");
    await run("UPDATE clients SET pin_hash = NULL WHERE id = 'c1'");
    expect(await epoch()).toBe(0);
    await run("UPDATE clients SET pin_hash = 'a' WHERE id = 'c1'");
    expect(await epoch()).toBe(1);
    await run("UPDATE clients SET pin_hash = 'a' WHERE id = 'c1'");
    expect(await epoch()).toBe(1);
    await run("UPDATE clients SET pin_hash = NULL WHERE id = 'c1'");
    expect(await epoch()).toBe(2);
  });
});
