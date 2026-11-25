import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

// T6.52: 0021 is hand-written; the drizzle snapshot is kept consistent by hand
// (as T6.40 did for 0020), so the next `drizzle-kit generate` sees no drift.
const read = (f) =>
  JSON.parse(
    readFileSync(
      new URL(`../../migrations/meta/${f}`, import.meta.url),
      "utf8",
    ),
  );

describe("migration 0021_client_pin snapshot (T6.52)", () => {
  it("adds only clients.pin_hash, chained to 0020", () => {
    const s20 = read("0020_snapshot.json");
    const s21 = read("0021_snapshot.json");
    expect(s21.prevId).toBe(s20.id);
    expect(s21.id).not.toBe(s20.id);
    expect(s21.tables.clients.columns.pin_hash).toMatchObject({
      name: "pin_hash",
      type: "text",
      primaryKey: false,
      notNull: false,
    });
    const without = (o, key) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
    expect(without(s21.tables.clients.columns, "pin_hash")).toEqual(
      s20.tables.clients.columns,
    );
    expect(without(s21.tables, "clients")).toEqual(
      without(s20.tables, "clients"),
    );
    expect({ ...s21.tables.clients, columns: 0 }).toEqual({
      ...s20.tables.clients,
      columns: 0,
    });
  });

  it("is the last journal entry", () => {
    expect(read("_journal.json").entries.at(-1)).toMatchObject({
      idx: 21,
      tag: "0021_client_pin",
      breakpoints: true,
    });
  });
});
