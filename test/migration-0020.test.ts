import { applyD1Migrations } from "cloudflare:test";
import { testMigrations } from "./support/d1";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const all = testMigrations();
const idx = all.findIndex((m) => m.name.startsWith("0020_"));
const run = (s: string, ...b: unknown[]) =>
  env.DB.prepare(s)
    .bind(...b)
    .run();
const rejects = async (s: string, ...b: unknown[]) => {
  let err: unknown = null;
  try {
    await run(s, ...b);
  } catch (e) {
    err = e;
  }
  expect(err, s).not.toBeNull();
  return String((err as Error).message + String((err as Error).cause ?? ""));
};
const client = (id: string, slug: string) =>
  run("INSERT INTO clients (id, slug, name) VALUES (?1, ?2, 'N')", id, slug);
const gallery = (id: string, slug: string, clientId: string | null = null) =>
  run(
    "INSERT INTO galleries (id, drive_folder_id, slug, title, client_id) VALUES (?1, ?2, ?3, 'T', ?4)",
    id,
    `f-${id}`,
    slug,
    clientId,
  );

describe("migration 0020_clients (T6.40a)", () => {
  it("is named 0020_clients.sql, right after 0019", () => {
    expect(all[idx]?.name).toBe("0020_clients.sql");
    expect(all[idx - 1]?.name).toBe("0019_ignored_folders.sql");
  });

  it("applies on a database with existing galleries; they get client_id NULL", async () => {
    await applyD1Migrations(env.DB, all.slice(0, idx));
    await run(
      "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('g0', 'f0', 'old', 'T')",
    );
    await applyD1Migrations(env.DB, all);
    const g = await env.DB.prepare(
      "SELECT client_id FROM galleries WHERE id = 'g0'",
    ).first<{ client_id: string | null }>();
    expect(g).toEqual({ client_id: null });
  });

  it("clients has the documented columns and defaults", async () => {
    await client("c-def", "defaults");
    const r = await env.DB.prepare(
      "SELECT * FROM clients WHERE id = 'c-def'",
    ).first<Record<string, unknown>>();
    expect(Object.keys(r!).sort()).toEqual([
      "created_at",
      "default_mode",
      "default_show_on_home",
      "id",
      "name",
      "page_enabled",
      "pin_hash", // added by 0021 (T6.52)
      "slug",
    ]);
    expect(r).toMatchObject({
      default_mode: "proofing",
      default_show_on_home: 0,
      page_enabled: 1,
    });
    expect(r!.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it("CHECKs: slug format/length, name, enum, booleans", async () => {
    for (const bad of [
      "",
      "-a",
      "a-",
      "a--b",
      "A",
      "a b",
      "a/b",
      "a.b",
      "x".repeat(61),
    ])
      await rejects(
        "INSERT INTO clients (id, slug, name) VALUES ('x', ?1, 'N')",
        bad,
      );
    await rejects(
      "INSERT INTO clients (id, slug, name) VALUES ('x', 'ok-1', '')",
    );
    await rejects(
      "INSERT INTO clients (id, slug, name) VALUES ('x', 'ok-2', ?1)",
      "n".repeat(121),
    );
    await rejects(
      "INSERT INTO clients (id, slug, name, default_mode) VALUES ('x', 'ok-3', 'N', 'bogus')",
    );
    await rejects(
      "INSERT INTO clients (id, slug, name, default_show_on_home) VALUES ('x', 'ok-4', 'N', 2)",
    );
    await rejects(
      "INSERT INTO clients (id, slug, name, page_enabled) VALUES ('x', 'ok-5', 'N', 2)",
    );
    await client("c60", "x".repeat(60));
  });

  it("client slugs are unique case-insensitively", async () => {
    await client("c-u1", "unique-one");
    // the lowercase CHECK rejects upper case first; the NOCASE index backs it up
    await rejects(
      "INSERT INTO clients (id, slug, name) VALUES ('c-u3', 'unique-one', 'N')",
    );
  });

  it("trigger: a client slug equal to a gallery slug (case-insensitive) aborts, insert and update", async () => {
    await gallery("g-a", "Boda-Ana");
    expect(
      await rejects(
        "INSERT INTO clients (id, slug, name) VALUES ('c-a', 'boda-ana', 'N')",
      ),
    ).toMatch(/slug_taken/);
    await client("c-b", "otro-cliente");
    expect(
      await rejects("UPDATE clients SET slug = 'boda-ana' WHERE id = 'c-b'"),
    ).toMatch(/slug_taken/);
    await run("UPDATE clients SET name = 'renamed' WHERE id = 'c-b'");
    await run("UPDATE clients SET slug = 'libre' WHERE id = 'c-b'");
  });

  it("trigger: a gallery slug equal to a client slug (case-insensitive) aborts, insert and update", async () => {
    await client("c-c", "coca-cola");
    expect(
      await rejects(
        "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('g-x', 'f-x', 'Coca-Cola', 'T')",
      ),
    ).toMatch(/slug_taken/);
    await gallery("g-y", "winter");
    expect(
      await rejects("UPDATE galleries SET slug = 'COCA-COLA' WHERE id = 'g-y'"),
    ).toMatch(/slug_taken/);
    await run("UPDATE galleries SET title = 'x' WHERE id = 'g-y'");
    await run("UPDATE galleries SET slug = 'winter-2' WHERE id = 'g-y'");
  });

  it("a client may keep its own slug on update (no self-collision)", async () => {
    await client("c-s", "same-one");
    await run("UPDATE clients SET slug = 'same-one' WHERE id = 'c-s'");
  });

  it("galleries.client_id: FK enforced, ON DELETE SET NULL, indexed", async () => {
    await rejects(
      "INSERT INTO galleries (id, drive_folder_id, slug, title, client_id) VALUES ('g-fk', 'f-fk', 'fk-one', 'T', 'nope')",
    );
    await client("c-fk", "fk-client");
    await gallery("g-fk2", "fk-album", "c-fk");
    await run("DELETE FROM clients WHERE id = 'c-fk'");
    const g = await env.DB.prepare(
      "SELECT client_id FROM galleries WHERE id = 'g-fk2'",
    ).first<{ client_id: string | null }>();
    expect(g).toEqual({ client_id: null });
    const ix = (
      await env.DB.prepare(
        "SELECT name FROM pragma_index_list('galleries')",
      ).all<{ name: string }>()
    ).results.map((r) => r.name);
    expect(ix).toContain("galleries_client_id_idx");
  });
});
