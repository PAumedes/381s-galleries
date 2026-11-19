import { describe, expect, it } from "vitest";
import * as old from "./_oldba";
import {
  fmtStudio,
  localToUtcIso,
  resolveExpiry,
  studioParts,
  utcIsoToLocal,
  validTimezone,
} from "../../app/lib/studio-time";

const sweep: number[] = [];
for (let y = 2000; y <= 2040; y++)
  for (const md of ["01-01", "02-29", "03-01", "06-15", "10-31", "12-31"])
    for (const hms of ["00:00:00", "02:59:59", "03:00:00", "23:59:59"])
      sweep.push(Date.parse(`${y}-${md}T${hms}Z`));
const valid = sweep.filter((t) => !Number.isNaN(t));

describe("owner sees no change (default zone == fixed UTC-3)", () => {
  it("2010+ instants identical to old ba-time", () => {
    const bad: string[] = [];
    for (const t of valid.filter((t) => t >= Date.parse("2010-01-01"))) {
      const iso = new Date(t).toISOString();
      if (JSON.stringify(studioParts(iso)) !== JSON.stringify(old.baParts(iso)))
        bad.push(iso);
      if (fmtStudio(iso) !== old.fmtBa(iso)) bad.push(iso);
    }
    expect(bad).toEqual([]);
  });
  it("pre-2010 instants follow the historical IANA rules (Argentina had DST until 2009)", () => {
    // intended: more correct than the old fixed UTC-3
    expect(fmtStudio("2008-12-15T12:00:00Z")).toBe("15/12/2008 10:00"); // UTC-2 summer
    expect(old.fmtBa("2008-12-15T12:00:00Z")).toBe("15/12/2008 09:00");
  });
  it("local->UTC identical for default", () => {
    const bad: string[] = [];
    for (const d of ["2026-01-01", "2028-02-29", "2026-12-31", "2010-12-15"])
      for (const t of ["00:00", "12:34", "23:59"])
        if (localToUtcIso(d, t) !== old.baLocalToUtcIso(d, t)) bad.push(d + t);
    expect(bad).toEqual([]);
  });
});

describe("round trips", () => {
  const zones = [
    "America/New_York", "Europe/London", "Australia/Lord_Howe", "Asia/Kolkata",
    "Pacific/Chatham", "Pacific/Apia", "Pacific/Kiritimati", "America/Sao_Paulo",
    "Europe/Moscow", "America/Caracas", "Africa/Casablanca", "Asia/Tehran",
  ];
  for (const z of zones)
    it(`UTC->local->UTC identity for ${z}`, () => {
      const bad: string[] = [];
      for (let t = Date.parse("2011-01-01T00:07:00Z"); t < Date.parse("2027-01-01"); t += 37 * 3600e3 + 11 * 60e3) {
        const iso = new Date(t).toISOString().replace(/\.\d+Z$/, "Z");
        const l = utcIsoToLocal(iso, z)!;
        const back = localToUtcIso(l.date, l.time, z);
        // seconds are dropped by HH:MM; compare at minute resolution
        const exp = iso.slice(0, 16);
        // ambiguous hour may legitimately map to the earlier instant
        const earlier = back && Date.parse(back) <= t;
        if (!back || !(back.slice(0, 16) === exp || earlier)) bad.push(`${iso} ${l.date} ${l.time} ${back}`);
        if (back && back.slice(0, 16) !== exp && Date.parse(back) < t - 3600e3) bad.push(`far ${iso} ${back}`);
      }
      expect(bad).toEqual([]);
    });
  it("gap/overlap rules", () => {
    expect(localToUtcIso("2026-03-08", "02:30", "America/New_York")).toBe("2026-03-08T07:30:00Z");
    expect(localToUtcIso("2026-11-01", "01:30", "America/New_York")).toBe("2026-11-01T05:30:00Z");
    expect(localToUtcIso("2026-10-04", "02:15", "Australia/Lord_Howe")).toBe("2026-10-03T15:45:00Z");
    expect(localToUtcIso("2011-12-30", "12:00", "Pacific/Apia")).toBe("2011-12-30T22:00:00Z");
  });
});

describe("timezone validation", () => {
  for (const [input, exp] of [
    ["Etc/GMT+3", "Etc/GMT+3"], ["UTC+3", "America/Argentina/Buenos_Aires"],
    ["../x", "America/Argentina/Buenos_Aires"], ["x".repeat(5000), "America/Argentina/Buenos_Aires"],
    ["", "America/Argentina/Buenos_Aires"], ["  ", "America/Argentina/Buenos_Aires"],
    ["GMT+3", "America/Argentina/Buenos_Aires"],
  ] as const)
    it(`validTimezone(${JSON.stringify(input).slice(0, 20)})`, () => {
      expect(validTimezone(input)).toBe(exp);
    });
  it("Etc/GMT+3 is UTC-3 (sign inverted)", () => {
    expect(fmtStudio("2026-06-01T12:00:00Z", "Etc/GMT+3")).toBe("01/06/2026 09:00");
  });
  it("non-string env values never throw", () => {
    expect(validTimezone(undefined)).toBe("America/Argentina/Buenos_Aires");
    expect(validTimezone(123 as unknown)).toBe("America/Argentina/Buenos_Aires");
  });
});

describe("no-op save of an expiry inside the fall-back overlap", () => {
  it("re-saving the edit form must not move expiry (second 01:30 EST)", () => {
    const stored = "2026-11-01T06:30:00Z"; // 01:30 EST, second occurrence
    const l = utcIsoToLocal(stored, "America/New_York")!;
    expect(resolveExpiry(l.date, l.time, stored, "America/New_York")).toBe(stored);
  });
  it("changing the time converts", () => {
    expect(resolveExpiry("2026-11-01", "01:45", "2026-11-01T06:30:00Z", "America/New_York")).toBe("2026-11-01T05:45:00Z");
    expect(resolveExpiry("2026-11-02", "01:30", "2026-11-01T06:30:00Z", "America/New_York")).toBe("2026-11-02T06:30:00Z");
  });
  it("no stored expiry converts normally", () => {
    expect(resolveExpiry("2026-11-01", "01:30", null, "America/New_York")).toBe("2026-11-01T05:30:00Z");
  });
});
