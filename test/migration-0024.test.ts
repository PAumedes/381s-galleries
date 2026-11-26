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
  await resetTables("photo_versions", "photos", "galleries");
  await run(
    "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('gA','fA','aa','A')",
  );
});

describe("T6.53d migration 0024: photos.drive_tiff_id", () => {
  it("is NULL for every existing and new photo unless set", async () => {
    await run(
      "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES ('p','gA','x','h')",
    );
    expect(await rows("SELECT drive_tiff_id t FROM photos")).toEqual([
      { t: null },
    ]);
  });

  it("keeps the 0012/0013 warm triggers (a high-res change still clears the expected key)", async () => {
    await run(
      "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id, cache_expected_key) VALUES ('p','gA','x','h','k')",
    );
    await run("UPDATE photos SET drive_highres_id = 'h2' WHERE id = 'p'");
    expect(await rows("SELECT cache_expected_key k FROM photos")).toEqual([
      { k: null },
    ]);
  });

  it("a TIFF-only swap (high-res and TIFF ids move together) clears the expected key", async () => {
    await run(
      "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id, drive_tiff_id, cache_expected_key) VALUES ('p','gA','x','t','t','k')",
    );
    await run(
      "UPDATE photos SET drive_highres_id = 't2', drive_tiff_id = 't2' WHERE id = 'p'",
    );
    expect(await rows("SELECT cache_expected_key k FROM photos")).toEqual([
      { k: null },
    ]);
  });

  it("keeps the other photos triggers", async () => {
    const t = await rows(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='photos' ORDER BY name",
    );
    expect(t.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        "photos_clear_cover_on_delete",
        "photos_clear_cover_mobile_on_delete",
        "photos_warm_invalidate",
        "photos_warm_insert",
      ]),
    );
  });
});
