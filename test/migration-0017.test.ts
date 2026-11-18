import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const all = (env as unknown as { TEST_MIGRATIONS: D1Migration[] })
  .TEST_MIGRATIONS;

describe("migration 0017_mobile_cover on a database with existing rows", () => {
  it("is the next migration and keeps every existing gallery as it was", async () => {
    const idx = all.findIndex((m) => m.name.startsWith("0017_"));
    expect(all[idx]?.name).toBe("0017_mobile_cover.sql");
    expect(idx).toBe(all.length - 1);

    // A database deployed before this change: everything up to 0016.
    await applyD1Migrations(env.DB, all.slice(0, idx));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title, status, palette, cover_focus_x, cover_focus_y, show_on_home) VALUES ('mg1','mf1','m-uno','Uno','published','arena',12.5,80,1)",
      ),
      env.DB.prepare(
        "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id, sort) VALUES ('mp1','mg1','a','d1',0)",
      ),
      env.DB.prepare(
        "UPDATE galleries SET cover_photo_id = 'mp1' WHERE id = 'mg1'",
      ),
    ]);

    await applyD1Migrations(env.DB, all);
    const r = await env.DB.prepare(
      "SELECT title, status, palette, cover_photo_id, cover_focus_x, cover_focus_y, show_on_home, cover_photo_id_mobile, cover_focus_mobile_x, cover_focus_mobile_y FROM galleries WHERE id = 'mg1'",
    ).first();
    expect(r).toEqual({
      title: "Uno",
      status: "published",
      palette: "arena",
      cover_photo_id: "mp1",
      cover_focus_x: 12.5,
      cover_focus_y: 80,
      show_on_home: 1,
      cover_photo_id_mobile: null,
      cover_focus_mobile_x: null,
      cover_focus_mobile_y: null,
    });

    // The new rules hold on old rows too.
    await expect(
      env.DB.prepare(
        "UPDATE galleries SET cover_focus_mobile_x = 101 WHERE id = 'mg1'",
      ).run(),
    ).rejects.toThrow();
    // Moving a photo away from the gallery that uses it as mobile cover clears it.
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title, status) VALUES ('mg2','mf2','m-dos','Dos','draft')",
      ),
      env.DB.prepare(
        "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id, sort) VALUES ('mp2','mg1','b','d2',1)",
      ),
      env.DB.prepare(
        "UPDATE galleries SET cover_photo_id_mobile = 'mp2' WHERE id = 'mg1'",
      ),
    ]);
    await env.DB.prepare(
      "UPDATE photos SET gallery_id = 'mg2' WHERE id = 'mp2'",
    ).run();
    expect(
      await env.DB.prepare(
        "SELECT cover_photo_id_mobile FROM galleries WHERE id = 'mg1'",
      ).first("cover_photo_id_mobile"),
    ).toBeNull();
    await env.DB.prepare(
      "UPDATE galleries SET cover_photo_id_mobile = 'mp1', cover_focus_mobile_x = 1, cover_focus_mobile_y = 2 WHERE id = 'mg1'",
    ).run();
    await env.DB.prepare("DELETE FROM photos WHERE id = 'mp1'").run();
    const after = await env.DB.prepare(
      "SELECT cover_photo_id, cover_photo_id_mobile, cover_focus_mobile_x FROM galleries WHERE id = 'mg1'",
    ).first();
    expect(after).toEqual({
      cover_photo_id: null,
      cover_photo_id_mobile: null,
      cover_focus_mobile_x: null,
    });
  });

  it("clears a mobile cover when its photo is moved to another gallery (fresh DB)", async () => {
    await applyD1Migrations(env.DB, all);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM galleries WHERE id IN ('mvg1','mvg2')"),
      env.DB.prepare(
        "INSERT INTO galleries (id, drive_folder_id, slug, title, status) VALUES ('mvg1','mvf1','mv-1','A','draft'),('mvg2','mvf2','mv-2','B','draft')",
      ),
      env.DB.prepare(
        "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id, sort) VALUES ('mvp1','mvg1','a','d1',0)",
      ),
      env.DB.prepare(
        "UPDATE galleries SET cover_photo_id_mobile = 'mvp1', cover_focus_mobile_x = 5, cover_focus_mobile_y = 6 WHERE id = 'mvg1'",
      ),
    ]);
    await env.DB.prepare(
      "UPDATE photos SET gallery_id = 'mvg2' WHERE id = 'mvp1'",
    ).run();
    expect(
      await env.DB.prepare(
        "SELECT cover_photo_id_mobile, cover_focus_mobile_x, cover_focus_mobile_y FROM galleries WHERE id = 'mvg1'",
      ).first(),
    ).toEqual({
      cover_photo_id_mobile: null,
      cover_focus_mobile_x: null,
      cover_focus_mobile_y: null,
    });
  });
});
