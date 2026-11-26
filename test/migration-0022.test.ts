import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { testMigrations } from "./support/d1";

const all = testMigrations();
const idx = all.findIndex((m) => m.name.startsWith("0022_"));
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
const count = async (t: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) n FROM ${t}`).first<{ n: number }>())!
    .n;

describe("migration 0022_photo_versions (T6.53a)", () => {
  it("is named 0022_photo_versions.sql, right after 0021", () => {
    expect(all[idx]?.name).toBe("0022_photo_versions.sql");
    expect(all[idx - 1]?.name).toBe("0021_client_pin.sql");
  });

  it("backfills one v1 row per existing photo that mirrors its columns; galleries default to versioning off", async () => {
    await applyD1Migrations(env.DB, all.slice(0, idx));
    await run(
      "INSERT INTO galleries (id, drive_folder_id, slug, title, status) VALUES ('g1','f1','boda','B','published'), ('g2','f2','xv','X','draft')",
    );
    await run(
      `INSERT INTO photos (id, gallery_id, base_name, drive_highres_id, drive_web_id, drive_ig_id, drive_thumb_id, drive_wm_id, drive_thumb_wm_id, highres_bytes, variant_versions, width, height)
       VALUES ('p1','g1','A','hr1','w1','i1','t1','m1','tm1',1234,'{"highres":"x"}',600,400),
              ('p2','g1','B','hr2',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
              ('p3','g2','C','hr3','w3',NULL,NULL,NULL,NULL,9,NULL,10,20)`,
    );
    await applyD1Migrations(env.DB, all);
    expect(await count("photo_versions")).toBe(3);
    expect(
      await rows(
        `SELECT photo_id, gallery_id, version, round_id, drive_highres_id, drive_web_id, drive_ig_id, drive_thumb_id, drive_wm_id,
                drive_thumb_wm_id, drive_tiff_id, highres_bytes, drive_versions, width, height
         FROM photo_versions ORDER BY photo_id`,
      ),
    ).toEqual([
      {
        photo_id: "p1",
        gallery_id: "g1",
        version: 1,
        round_id: null,
        drive_highres_id: "hr1",
        drive_web_id: "w1",
        drive_ig_id: "i1",
        drive_thumb_id: "t1",
        drive_wm_id: "m1",
        drive_thumb_wm_id: "tm1",
        drive_tiff_id: null,
        highres_bytes: 1234,
        drive_versions: '{"highres":"x"}',
        width: 600,
        height: 400,
      },
      expect.objectContaining({
        photo_id: "p2",
        version: 1,
        drive_highres_id: "hr2",
        width: null,
      }),
      expect.objectContaining({ photo_id: "p3", version: 1, width: 10 }),
    ]);
    expect(
      (await rows("SELECT first_seen_at f FROM photo_versions")).every(
        (r) => typeof r.f === "string" && (r.f as string).length >= 20,
      ),
    ).toBe(true);
    expect(
      await rows("SELECT id, versioning FROM galleries ORDER BY id"),
    ).toEqual([
      { id: "g1", versioning: 0 },
      { id: "g2", versioning: 0 },
    ]);
    expect(await count("delivery_rounds")).toBe(0);
  });

  it("(photo_id, version) is the key; versioning and version are checked", async () => {
    await expect(
      run(
        "INSERT INTO photo_versions (photo_id, gallery_id, version, drive_highres_id) VALUES ('p1', 'g1', 1, 'again')",
      ),
    ).rejects.toThrow();
    await expect(
      run(
        "INSERT INTO photo_versions (photo_id, gallery_id, version, drive_highres_id) VALUES ('p1', 'g1', 0, 'z')",
      ),
    ).rejects.toThrow();
    await expect(
      run("UPDATE galleries SET versioning = 2 WHERE id = 'g1'"),
    ).rejects.toThrow();
    await expect(
      run("UPDATE galleries SET versioning = NULL WHERE id = 'g1'"),
    ).rejects.toThrow();
    await run(
      "INSERT INTO photo_versions (photo_id, gallery_id, version, drive_highres_id) VALUES ('p1', 'g1', 2, 'hr1b')",
    );
    await expect(
      run(
        "INSERT INTO photo_versions (photo_id, gallery_id, version, drive_highres_id) VALUES ('nope', 'g1', 1, 'z')",
      ),
    ).rejects.toThrow();
  });

  it("integrity: a version's round and photo belong to its own gallery; ids are integers", async () => {
    await run(
      "INSERT INTO delivery_rounds (id, gallery_id, number) VALUES ('rg2','g2',1)",
    );
    await expect(
      run(
        "INSERT INTO photo_versions (photo_id, gallery_id, version, round_id, drive_highres_id) VALUES ('p1','g1',3,'rg2','h')",
      ),
    ).rejects.toThrow();
    await expect(
      run(
        "INSERT INTO photo_versions (photo_id, gallery_id, version, drive_highres_id) VALUES ('p1','g2',3,'h')",
      ),
    ).rejects.toThrow();
    await expect(
      run(
        "INSERT INTO photo_versions (photo_id, gallery_id, version, drive_highres_id) VALUES ('p1','g1','2x','h')",
      ),
    ).rejects.toThrow();
    await run("DELETE FROM delivery_rounds WHERE id = 'rg2'");
  });

  it("rounds: unique number per gallery; deleting a round keeps its versions (round_id NULL)", async () => {
    await run(
      "INSERT INTO delivery_rounds (id, gallery_id, number) VALUES ('r1','g1',1)",
    );
    await expect(
      run(
        "INSERT INTO delivery_rounds (id, gallery_id, number) VALUES ('r1b','g1',1)",
      ),
    ).rejects.toThrow();
    await run(
      "UPDATE photo_versions SET round_id = 'r1' WHERE photo_id='p1' AND version=2",
    );
    await run("DELETE FROM delivery_rounds WHERE id = 'r1'");
    expect(
      await rows(
        "SELECT round_id FROM photo_versions WHERE photo_id='p1' AND version=2",
      ),
    ).toEqual([{ round_id: null }]);
    expect(
      await rows(
        "SELECT gallery_id FROM photo_versions WHERE photo_id='p1' AND version=2",
      ),
    ).toEqual([{ gallery_id: "g1" }]);
  });

  it("deleting a photo or a gallery removes its version and round rows (FK cascade)", async () => {
    await run(
      "INSERT INTO delivery_rounds (id, gallery_id, number) VALUES ('r2','g1',2)",
    );
    await run("DELETE FROM photos WHERE id = 'p1'");
    expect(
      await rows("SELECT photo_id FROM photo_versions ORDER BY photo_id"),
    ).toEqual([{ photo_id: "p2" }, { photo_id: "p3" }]);
    await run("DELETE FROM galleries WHERE id = 'g1'");
    expect(await rows("SELECT photo_id FROM photo_versions")).toEqual([
      { photo_id: "p3" },
    ]);
    expect(await count("delivery_rounds")).toBe(0);
  });

  it("keeps the 0020 slug-namespace triggers and the 0021 pin_epoch trigger", async () => {
    const names = (
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger'",
      ).all<{ name: string }>()
    ).results.map((r) => r.name);
    for (const t of [
      "clients_slug_namespace_insert",
      "clients_slug_namespace_update",
      "galleries_slug_namespace_insert",
      "galleries_slug_namespace_update",
      "clients_pin_epoch",
      "photos_clear_cover_on_delete",
    ])
      expect(names).toContain(t);
    await run(
      "INSERT INTO clients (id, slug, name) VALUES ('c1','solo-c','N')",
    );
    await expect(
      run("INSERT INTO clients (id, slug, name) VALUES ('c2','xv','N')"),
    ).rejects.toThrow(/slug_taken/);
    const fk = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'galleries'",
    ).first<{ sql: string }>();
    expect(fk!.sql).toMatch(/REFERENCES clients\(id\) ON DELETE SET NULL/);
  });
});
