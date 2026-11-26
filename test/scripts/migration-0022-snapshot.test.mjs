import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

// T6.53a: 0022 is hand-written; the drizzle snapshot is kept consistent by hand.
const read = (f) =>
  JSON.parse(
    readFileSync(
      new URL(`../../migrations/meta/${f}`, import.meta.url),
      "utf8",
    ),
  );

describe("migration 0022_photo_versions snapshot (T6.53a)", () => {
  const s21 = read("0021_snapshot.json");
  const s22 = read("0022_snapshot.json");

  it("chains to 0021 and adds only the two tables and galleries.versioning", () => {
    expect(s22.prevId).toBe(s21.id);
    expect(s22.id).not.toBe(s21.id);
    expect(Object.keys(s22.tables).sort()).toEqual(
      [...Object.keys(s21.tables), "delivery_rounds", "photo_versions"].sort(),
    );
    expect(s22.tables.galleries.columns.versioning).toMatchObject({
      type: "integer",
      notNull: true,
      default: 0,
    });
    const rest = { ...s22.tables.galleries.columns };
    delete rest.versioning;
    expect(rest).toEqual(s21.tables.galleries.columns);
    for (const t of Object.keys(s21.tables).filter((t) => t !== "galleries"))
      expect(s22.tables[t]).toEqual(s21.tables[t]);
  });

  it("photo_versions has the composite key and cascades from photos", () => {
    const pv = s22.tables.photo_versions;
    expect(Object.values(pv.compositePrimaryKeys)[0].columns).toEqual([
      "photo_id",
      "version",
    ]);
    expect(
      Object.values(pv.foreignKeys).map((f) => [f.tableTo, f.onDelete]),
    ).toEqual(
      expect.arrayContaining([
        ["photos", "cascade"],
        ["delivery_rounds", "set null"],
      ]),
    );
  });

  it("is the last journal entry", () => {
    expect(read("_journal.json").entries.at(-1)).toMatchObject({
      idx: 22,
      tag: "0022_photo_versions",
      breakpoints: true,
    });
  });
});
