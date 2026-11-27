import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateDb, resetTables } from "./support/d1";

const run = (s: string, ...b: unknown[]) =>
  env.DB.prepare(s)
    .bind(...b)
    .run();
const rows = async (s: string, ...b: unknown[]) =>
  (
    await env.DB.prepare(s)
      .bind(...b)
      .all()
  ).results;

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables(
    "photo_approvals",
    "photo_versions",
    "favorites",
    "visitors",
    "photos",
    "galleries",
  );
  await run(
    "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('gA','fA','aa','A'), ('gB','fB','bb','B')",
  );
  await run(
    "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES ('pA','gA','x','h'), ('pB','gB','y','h')",
  );
  await run(
    "INSERT INTO photo_versions (photo_id, gallery_id, version, drive_highres_id) VALUES ('pA','gA',1,'h'), ('pA','gA',2,'h2'), ('pB','gB',1,'h')",
  );
  await run(
    "INSERT INTO visitors (id, gallery_id, email) VALUES ('vA','gA','a@x.co'), ('vB','gB','b@x.co')",
  );
});

const approve = (g: string, p: string, ver: unknown, v: string) =>
  run(
    "INSERT INTO photo_approvals (gallery_id, photo_id, version, visitor_id) VALUES (?1, ?2, ?3, ?4)",
    g,
    p,
    ver,
    v,
  );
const count = async () =>
  (await rows("SELECT COUNT(*) n FROM photo_approvals"))[0].n;

describe("T6.53f migration 0025: photo_approvals", () => {
  it("stores one approval per (photo, version, visitor) with a default timestamp", async () => {
    await approve("gA", "pA", 2, "vA");
    const r = await rows("SELECT approved_at a FROM photo_approvals");
    expect(String(r[0].a)).toMatch(/^\d{4}-\d\d-\d\dT/);
    await expect(approve("gA", "pA", 2, "vA")).rejects.toThrow();
    await approve("gA", "pA", 1, "vA"); // another version is its own row
    expect(await count()).toBe(2);
  });

  it("refuses a photo of another gallery, a visitor of another gallery and a missing version", async () => {
    await expect(approve("gA", "pB", 1, "vA")).rejects.toThrow();
    await expect(approve("gA", "pA", 1, "vB")).rejects.toThrow();
    await expect(approve("gA", "pA", 3, "vA")).rejects.toThrow();
    await expect(approve("gB", "pA", 1, "vB")).rejects.toThrow();
  });

  it("version must be a positive integer (typeof check)", async () => {
    await expect(approve("gA", "pA", "abc", "vA")).rejects.toThrow();
    await expect(approve("gA", "pA", 0, "vA")).rejects.toThrow();
    await expect(approve("gA", "pA", 1.5, "vA")).rejects.toThrow();
  });

  it("cascades with the photo, the visitor, the version row and the gallery (no orphans)", async () => {
    await approve("gA", "pA", 1, "vA");
    await approve("gA", "pA", 2, "vA");
    await run("DELETE FROM photo_versions WHERE photo_id='pA' AND version=2");
    expect(await count()).toBe(1);
    await run("DELETE FROM visitors WHERE id='vA'");
    expect(await count()).toBe(0);
    await approve("gA", "pA", 1, "vA").catch(() => undefined);
    await run(
      "INSERT INTO visitors (id, gallery_id, email) VALUES ('vA','gA','a@x.co')",
    ).catch(() => undefined);
    await approve("gA", "pA", 1, "vA");
    await run("DELETE FROM photos WHERE id='pA'");
    expect(await count()).toBe(0);
    expect(await rows("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("indexes the gallery/visitor lookups", async () => {
    const plan = await rows(
      "EXPLAIN QUERY PLAN SELECT photo_id, version FROM photo_approvals WHERE gallery_id = 'gA' AND visitor_id = 'vA'",
    );
    expect(JSON.stringify(plan)).toMatch(/USING (COVERING )?INDEX/);
  });

  it("keeps the photos / versions triggers (0000-0023) intact", async () => {
    const t = await rows(
      "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name",
    );
    expect(t.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        "photos_clear_cover_on_delete",
        "photos_warm_invalidate",
        "delivery_rounds_unlink_versions",
      ]),
    );
  });
});
