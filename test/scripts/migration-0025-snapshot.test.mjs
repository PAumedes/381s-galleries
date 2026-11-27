import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

// T6.53f: 0025 is hand-written; the snapshot is kept consistent with schema.ts
// (the drift test runs drizzle-kit generate and expects a no-op).
const read = (f) =>
  JSON.parse(
    readFileSync(
      new URL(`../../migrations/meta/${f}`, import.meta.url),
      "utf8",
    ),
  );

describe("migration 0025_photo_approvals snapshot (T6.53f)", () => {
  const s24 = read("0024_snapshot.json");
  const s25 = read("0025_snapshot.json");

  it("chains to 0024 and adds only photo_approvals", () => {
    expect(s25.prevId).toBe(s24.id);
    expect(s25.id).not.toBe(s24.id);
    expect(Object.keys(s25.tables).sort()).toEqual(
      [...Object.keys(s24.tables), "photo_approvals"].sort(),
    );
    for (const t of Object.keys(s24.tables))
      expect(s25.tables[t]).toEqual(s24.tables[t]);
    expect(Object.keys(s25.tables.photo_approvals.columns).sort()).toEqual(
      ["approved_at", "gallery_id", "photo_id", "version", "visitor_id"].sort(),
    );
  });

  it("is listed in the journal", () => {
    expect(read("_journal.json").entries[25]).toMatchObject({
      idx: 25,
      tag: "0025_photo_approvals",
    });
  });
});
