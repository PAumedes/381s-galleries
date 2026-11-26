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
  await resetTables("photo_versions", "delivery_rounds", "photos", "galleries");
  await run(
    "INSERT INTO galleries (id, drive_folder_id, slug, title) VALUES ('gA','fA','aa','A'), ('gB','fB','bb','B')",
  );
});

describe("T6.53b migration 0023: delivery_rounds.folder_round", () => {
  it("is NULL by default (suffix round) and many suffix rounds coexist", async () => {
    await run(
      "INSERT INTO delivery_rounds (id, gallery_id, number) VALUES ('r2','gA',2), ('r3','gA',3)",
    );
    expect(
      await rows("SELECT folder_round f FROM delivery_rounds ORDER BY number"),
    ).toEqual([{ f: null }, { f: null }]);
  });

  it("one folder round per (gallery, N); other galleries may reuse N", async () => {
    await run(
      "INSERT INTO delivery_rounds (id, gallery_id, number, folder_round) VALUES ('a','gA',2,2)",
    );
    await expect(
      run(
        "INSERT INTO delivery_rounds (id, gallery_id, number, folder_round) VALUES ('b','gA',3,2)",
      ),
    ).rejects.toThrow();
    await run(
      "INSERT INTO delivery_rounds (id, gallery_id, number, folder_round) VALUES ('c','gB',2,2)",
    );
  });

  it.each(["0", "-1", "'x'", "2.5"])("rejects folder_round %s", async (v) => {
    await expect(
      run(
        `INSERT INTO delivery_rounds (id, gallery_id, number, folder_round) VALUES ('z','gA',2,${v})`,
      ),
    ).rejects.toThrow();
  });

  it("the 0022 round-delete trigger survived (versions keep their row, round_id nulled)", async () => {
    await run(
      "INSERT INTO delivery_rounds (id, gallery_id, number) VALUES ('r','gA',2)",
    );
    await run(
      "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES ('p','gA','x','h')",
    );
    await run(
      "INSERT INTO photo_versions (photo_id, gallery_id, version, round_id, drive_highres_id) VALUES ('p','gA',2,'r','h2')",
    );
    await run("DELETE FROM delivery_rounds WHERE id='r'");
    expect(
      await rows("SELECT round_id r, gallery_id g FROM photo_versions"),
    ).toEqual([{ r: null, g: "gA" }]);
  });
});
