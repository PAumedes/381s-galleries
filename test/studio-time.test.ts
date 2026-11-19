import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIMEZONE,
  fmtStudio,
  localToUtcIso,
  studioParts,
  utcIsoToLocal,
  validTimezone,
} from "../app/lib/studio-time";
import { fmtStudioSeconds } from "../app/lib/admin-activity";
import { fmtStudioDateTime } from "../app/i18n/format";

const NY = "America/New_York";
const IN = "Asia/Kolkata";

describe("T6.21 studio timezone (validation)", () => {
  it("default is Buenos Aires", () => {
    expect(DEFAULT_TIMEZONE).toBe("America/Argentina/Buenos_Aires");
  });
  it("valid IANA names pass, others fall back to the default", () => {
    expect(validTimezone(NY)).toBe(NY);
    expect(validTimezone(IN)).toBe(IN);
    for (const bad of [
      "",
      "  ",
      "Mars/Olympus",
      "not a zone",
      undefined,
      null,
      5,
    ])
      expect(validTimezone(bad), String(bad)).toBe(DEFAULT_TIMEZONE);
  });
});

describe("T6.21 studio timezone (default = Buenos Aires, unchanged)", () => {
  it("instant -> local and back", () => {
    expect(studioParts("2026-01-01T02:30:00Z")).toEqual({
      date: "2025-12-31",
      time: "23:30:00",
    });
    expect(fmtStudio("2026-11-16T13:00:00Z")).toBe("16/11/2026 10:00");
    expect(fmtStudioSeconds("2026-01-01T12:00:02Z")).toBe(
      "2026-01-01 09:00:02",
    );
    expect(fmtStudioSeconds("2026-01-01T12:00:02Z", NY)).toBe(
      "2026-01-01 07:00:02",
    );
    expect(localToUtcIso("2026-12-24", "18:30")).toBe("2026-12-24T21:30:00Z");
    expect(utcIsoToLocal("2026-12-24T21:30:00Z")).toEqual({
      date: "2026-12-24",
      time: "18:30",
    });
  });
  it("invalid input", () => {
    expect(studioParts("garbage")).toBeNull();
    expect(studioParts(null)).toBeNull();
    expect(localToUtcIso("2026-02-30", "10:00")).toBeNull();
    expect(localToUtcIso("2026-01-01", "24:00")).toBeNull();
    expect(localToUtcIso("2026-01-01", "10:60")).toBeNull();
  });
  it("an invalid zone argument behaves like the default", () => {
    expect(fmtStudio("2026-11-16T13:00:00Z", "Nope/Zone")).toBe(
      "16/11/2026 10:00",
    );
  });
});

describe("T6.21 studio timezone (America/New_York, DST)", () => {
  it("instant -> local on both sides of both changes", () => {
    expect(fmtStudio("2026-03-08T06:59:00Z", NY)).toBe("08/03/2026 01:59");
    expect(fmtStudio("2026-03-08T07:00:00Z", NY)).toBe("08/03/2026 03:00");
    expect(fmtStudio("2026-11-01T05:30:00Z", NY)).toBe("01/11/2026 01:30");
    expect(fmtStudio("2026-11-01T06:30:00Z", NY)).toBe("01/11/2026 01:30");
    expect(fmtStudio("2026-11-01T07:00:00Z", NY)).toBe("01/11/2026 02:00");
  });
  it("midnight is 00, not 24", () => {
    expect(studioParts("2026-07-15T04:00:00Z", NY)).toEqual({
      date: "2026-07-15",
      time: "00:00:00",
    });
  });
  it("local -> UTC: winter and summer offsets", () => {
    expect(localToUtcIso("2026-01-15", "12:00", NY)).toBe(
      "2026-01-15T17:00:00Z",
    );
    expect(localToUtcIso("2026-07-15", "12:00", NY)).toBe(
      "2026-07-15T16:00:00Z",
    );
  });
  it("spring-forward gap: a nonexistent time moves forward", () => {
    expect(localToUtcIso("2026-03-08", "02:30", NY)).toBe(
      "2026-03-08T07:30:00Z",
    );
    expect(localToUtcIso("2026-03-08", "02:00", NY)).toBe(
      "2026-03-08T07:00:00Z",
    );
    expect(localToUtcIso("2026-03-08", "01:59", NY)).toBe(
      "2026-03-08T06:59:00Z",
    );
    expect(localToUtcIso("2026-03-08", "03:00", NY)).toBe(
      "2026-03-08T07:00:00Z",
    );
  });
  it("fall-back overlap: an ambiguous time takes the first occurrence", () => {
    expect(localToUtcIso("2026-11-01", "01:30", NY)).toBe(
      "2026-11-01T05:30:00Z",
    );
    expect(localToUtcIso("2026-11-01", "02:00", NY)).toBe(
      "2026-11-01T07:00:00Z",
    );
    expect(localToUtcIso("2026-11-01", "00:59", NY)).toBe(
      "2026-11-01T04:59:00Z",
    );
  });
  it("round-trips every non-ambiguous, existing local time", () => {
    const iso = localToUtcIso("2026-12-24", "23:59", NY)!;
    expect(utcIsoToLocal(iso, NY)).toEqual({
      date: "2026-12-24",
      time: "23:59",
    });
  });
});

describe("T6.21 studio timezone (Asia/Kolkata, +5:30)", () => {
  it("both directions", () => {
    expect(fmtStudio("2026-01-01T00:00:00Z", IN)).toBe("01/01/2026 05:30");
    expect(fmtStudio("2026-01-01T20:00:00Z", IN)).toBe("02/01/2026 01:30");
    expect(localToUtcIso("2026-01-01", "05:30", IN)).toBe(
      "2026-01-01T00:00:00Z",
    );
    expect(localToUtcIso("2026-01-01", "00:10", IN)).toBe(
      "2025-12-31T18:40:00Z",
    );
  });
});

describe("T6.21 studio timezone (formatting)", () => {
  it("fmtStudioDateTime honours the zone", () => {
    expect(fmtStudioDateTime("es", "2026-01-01T00:00:00Z", IN)).toBe(
      "01/01/2026 05:30",
    );
    expect(fmtStudioDateTime("es", "2026-01-01T00:00:00Z")).toBe(
      "31/12/2025 21:00",
    );
  });
});
