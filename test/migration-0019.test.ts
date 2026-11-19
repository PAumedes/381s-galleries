import { applyD1Migrations } from "cloudflare:test";
import { testMigrations } from "./support/d1";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const all = testMigrations();
const idx = all.findIndex((m) => m.name.startsWith("0019_"));

describe("migration 0019_ignored_folders", () => {
  it("is named 0019_ignored_folders.sql, right after 0018", () => {
    expect(all[idx]?.name).toBe("0019_ignored_folders.sql");
    expect(all[idx - 1]?.name).toBe("0018_visitor_data.sql");
  });

  it("applies on a database with existing galleries and creates the tombstone table", async () => {
    await applyD1Migrations(env.DB, all.slice(0, idx));
    await env.DB.prepare(
      "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('g1', 'f1', 's1', 'T')",
    ).run();
    await applyD1Migrations(env.DB, all);
    const cols = (
      await env.DB.prepare(
        "SELECT name, pk FROM pragma_table_info('ignored_folders')",
      ).all<{ name: string; pk: number }>()
    ).results;
    expect(cols.map((c) => c.name).sort()).toEqual([
      "deleted_at",
      "drive_folder_id",
    ]);
    expect(cols.find((c) => c.name === "drive_folder_id")?.pk).toBe(1);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) AS n FROM galleries").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
    await env.DB.prepare(
      "INSERT INTO ignored_folders (drive_folder_id) VALUES ('f1')",
    ).run();
    const row = await env.DB.prepare(
      "SELECT deleted_at FROM ignored_folders",
    ).first<{ deleted_at: string }>();
    expect(row?.deleted_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });
});
