import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateDb, resetTables } from "../support/d1";

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
    "photo_versions",
    "delivery_rounds",
    "photos",
    "galleries",
    "clients",
  );
  await run(
    "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('gA','fA','aa','A'), ('gB','fB','bb','B')",
  );
  await run(
    "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES ('pA','gA','x','hrA'), ('pB','gB','x','hrB')",
  );
});

describe("T6.53a adversarial: integrity", () => {
  it("a version cannot point at a round of ANOTHER gallery (favorites use a composite FK for this)", async () => {
    await run(
      "INSERT INTO delivery_rounds (id, gallery_id, number) VALUES ('rB','gB',1)",
    );
    await expect(
      run(
        "INSERT INTO photo_versions (photo_id, version, round_id, drive_highres_id) VALUES ('pA', 1, 'rB', 'h')",
      ),
    ).rejects.toThrow();
  });

  it("deleting gallery B must not null the round of gallery A's versions (consequence of cross-gallery round)", async () => {
    await run(
      "INSERT INTO delivery_rounds (id, gallery_id, number) VALUES ('rB','gB',1)",
    );
    await run(
      "INSERT INTO photo_versions (photo_id, version, round_id, drive_highres_id) VALUES ('pA', 2, 'rB', 'h')",
    ).catch(() => {});
    const before = await rows(
      "SELECT round_id FROM photo_versions WHERE photo_id='pA'",
    );
    // if the insert was refused there is nothing to corrupt; otherwise A's row is silently mutated
    await run("DELETE FROM galleries WHERE id='gB'");
    const after = await rows(
      "SELECT round_id FROM photo_versions WHERE photo_id='pA'",
    );
    expect(after).toEqual(before);
    expect(before.length).toBe(0); // must have been refused
  });

  it("version / number must be integers (TEXT passes `>= 1` in SQLite)", async () => {
    await expect(
      run(
        "INSERT INTO photo_versions (photo_id, version, drive_highres_id) VALUES ('pA', 'abc', 'h')",
      ),
    ).rejects.toThrow();
    await expect(
      run(
        "INSERT INTO delivery_rounds (id, gallery_id, number) VALUES ('rx','gA','abc')",
      ),
    ).rejects.toThrow();
  });

  // Decision (owner-visible, PLAN T6.53a): no mirror trigger (it would double sync D1 writes). T6.53b sync must upsert v1 from photos; the test comes back as a sync test there.
  it.skip("v1 mirror stays equal to photos after sync-style UPDATE of the variant columns (versioning=0 album)", async () => {
    await run(
      "INSERT INTO photo_versions (photo_id, version, drive_highres_id) VALUES ('pA', 1, 'hrA')",
    );
    await run(
      "UPDATE photos SET drive_highres_id='hrA2', highres_bytes=5, width=9 WHERE id='pA'",
    );
    const [v] = await rows(
      "SELECT drive_highres_id, highres_bytes, width FROM photo_versions WHERE photo_id='pA' AND version=1",
    );
    expect(v).toEqual({ drive_highres_id: "hrA2", highres_bytes: 5, width: 9 });
  });

  it("0020/0021 triggers still work after 0022 (probe)", async () => {
    await run("INSERT INTO clients (id, slug, name) VALUES ('c1','cc','N')");
    await run("UPDATE clients SET pin_hash='x' WHERE id='c1'");
    await run("UPDATE clients SET pin_hash='y' WHERE id='c1'");
    expect(
      (await rows("SELECT pin_epoch e FROM clients WHERE id='c1'"))[0],
    ).toEqual({ e: 2 });
    await expect(
      run("INSERT INTO clients (id, slug, name) VALUES ('c2','aa','N')"),
    ).rejects.toThrow(/slug_taken/);
    await expect(
      run("UPDATE galleries SET slug='cc' WHERE id='gA'"),
    ).rejects.toThrow(/slug_taken/);
  });
});
