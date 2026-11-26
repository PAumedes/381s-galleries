import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

// T6.53d: 0024 is hand-written; the drizzle snapshot is kept consistent by
// hand (as 0020-0023), so the next `drizzle-kit generate` sees no drift.
const read = (f) =>
  JSON.parse(
    readFileSync(
      new URL(`../../migrations/meta/${f}`, import.meta.url),
      "utf8",
    ),
  );

describe("migration 0024_tiff_original snapshot (T6.53d)", () => {
  const s23 = read("0023_snapshot.json");
  const s24 = read("0024_snapshot.json");

  it("chains to 0023 and adds only photos.drive_tiff_id", () => {
    expect(s24.prevId).toBe(s23.id);
    expect(s24.id).not.toBe(s23.id);
    expect(s24.tables.photos.columns.drive_tiff_id).toMatchObject({
      name: "drive_tiff_id",
      type: "text",
      primaryKey: false,
      notNull: false,
    });
    const rest = { ...s24.tables.photos.columns };
    delete rest.drive_tiff_id;
    expect(rest).toEqual(s23.tables.photos.columns);
    for (const t of Object.keys(s23.tables).filter((t) => t !== "photos"))
      expect(s24.tables[t]).toEqual(s23.tables[t]);
  });

  it("is listed in the journal", () => {
    const j = read("_journal.json");
    expect(j.entries.at(-1).tag).toBe("0024_tiff_original");
  });
});
