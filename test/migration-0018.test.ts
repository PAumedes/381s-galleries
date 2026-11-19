import { applyD1Migrations } from "cloudflare:test";
import { testMigrations } from "./support/d1";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const all = testMigrations();
const idx = all.findIndex((m) => m.name.startsWith("0018_"));

const NEW_COLS = [
  "region",
  "city",
  "continent",
  "timezone",
  "asn",
  "as_org",
  "lang",
  "referrer_host",
  "browser",
  "browser_version",
  "os",
  "device",
];

const cols = async (table: string) =>
  (
    await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{
      name: string;
    }>()
  ).results.map((r) => r.name);

describe("migration 0018_visitor_data", () => {
  it("is named 0018_visitor_data.sql", () => {
    expect(all[idx]?.name).toBe("0018_visitor_data.sql");
    expect(idx).toBeGreaterThanOrEqual(0);
  });

  it("on a database with existing rows: old rows keep working, new columns are null", async () => {
    await applyD1Migrations(env.DB, all.slice(0, idx));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title, status) VALUES ('mg1','mf1','m-uno','Uno','published')",
      ),
      env.DB.prepare(
        "INSERT INTO gallery_views (gallery_id, visitor_id, country, ip_hash) VALUES ('mg1', NULL, 'AR', 'abcdabcdabcdabcd')",
      ),
      env.DB.prepare(
        "INSERT INTO downloads (id, gallery_id, variant, kind, country, ua) VALUES ('dd1','mg1','web','single','UY','Mozilla/5.0')",
      ),
    ]);

    await applyD1Migrations(env.DB, all);

    const v = await env.DB.prepare(
      `SELECT country, ip_hash, ${NEW_COLS.join(", ")} FROM gallery_views`,
    ).first<Record<string, unknown>>();
    expect(v).toEqual({
      country: "AR",
      ip_hash: "abcdabcdabcdabcd",
      ...Object.fromEntries(NEW_COLS.map((c) => [c, null])),
    });
    const d = await env.DB.prepare(
      `SELECT country, ua, ip_hash, ${NEW_COLS.join(", ")} FROM downloads`,
    ).first<Record<string, unknown>>();
    expect(d).toEqual({
      country: "UY",
      ua: "Mozilla/5.0",
      ip_hash: null,
      ...Object.fromEntries(NEW_COLS.map((c) => [c, null])),
    });
  });

  it("adds exactly the new columns to both tables (fresh database)", async () => {
    await applyD1Migrations(env.DB, all);
    for (const t of ["gallery_views", "downloads"]) {
      const c = await cols(t);
      for (const n of NEW_COLS) expect(c).toContain(n);
    }
    expect(await cols("downloads")).toContain("ip_hash");
  });

  it("CHECK constraints reject a bad device and over-long values", async () => {
    await applyD1Migrations(env.DB, all);
    await env.DB.prepare(
      "INSERT INTO galleries (id, drive_folder_id, slug, title, status) VALUES ('cg','cf','c-uno','Uno','published') ON CONFLICT DO NOTHING",
    ).run();
    const ins = (col: string, val: unknown) =>
      env.DB.prepare(
        `INSERT INTO gallery_views (gallery_id, ${col}) VALUES ('cg', ?1)`,
      )
        .bind(val)
        .run();
    for (const d of ["mobile", "tablet", "desktop", "bot", "unknown"])
      await ins("device", d);
    await expect(ins("device", "toaster")).rejects.toThrow();
    await expect(ins("city", "x".repeat(101))).rejects.toThrow();
    await expect(ins("lang", "x".repeat(36))).rejects.toThrow();
    await expect(ins("referrer_host", "x".repeat(254))).rejects.toThrow();
    await expect(ins("asn", -1)).rejects.toThrow();
    await expect(ins("continent", "SAM")).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO downloads (id, gallery_id, variant, kind, browser) VALUES ('x1','cg','web','single', ?1)",
      )
        .bind("y".repeat(41))
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO downloads (id, gallery_id, variant, kind, ip_hash) VALUES ('x2','cg','web','single', ?1)",
      )
        .bind("h".repeat(65))
        .run(),
    ).rejects.toThrow();
  });
});
