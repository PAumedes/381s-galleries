import { describe, expect, it } from "vitest";
import {
  baLocalToUtcIso,
  groupIssues,
  movePhoto,
  parseFilter,
  sortPhotos,
  utcIsoToBaLocal,
} from "../app/lib/admin-gallery";

describe("parseFilter", () => {
  it("accepts the four tabs, anything else is todas", () => {
    expect(parseFilter("publicadas")).toBe("publicadas");
    expect(parseFilter("borradores")).toBe("borradores");
    expect(parseFilter("archivadas")).toBe("archivadas");
    expect(parseFilter("todas")).toBe("todas");
    expect(parseFilter("x")).toBe("todas");
    expect(parseFilter(null)).toBe("todas");
    expect(parseFilter("constructor")).toBe("todas");
  });
});

describe("Buenos Aires time conversion", () => {
  it("local -> UTC (+3h, stored in nowIso format)", () => {
    expect(baLocalToUtcIso("2026-12-24", "18:30")).toBe("2026-12-24T21:30:00Z");
    expect(baLocalToUtcIso("2026-12-31", "23:30")).toBe("2027-01-01T02:30:00Z");
    expect(baLocalToUtcIso("2028-02-28", "22:00")).toBe("2028-02-29T01:00:00Z");
  });
  it("rejects invalid dates/times", () => {
    expect(baLocalToUtcIso("2026-02-30", "10:00")).toBeNull();
    expect(baLocalToUtcIso("2026-13-01", "10:00")).toBeNull();
    expect(baLocalToUtcIso("2026-01-01", "25:00")).toBeNull();
    expect(baLocalToUtcIso("2026-01-01", "10:60")).toBeNull();
    expect(baLocalToUtcIso("26-01-01", "10:00")).toBeNull();
    expect(baLocalToUtcIso("2026-01-01", "")).toBeNull();
  });
  it("UTC -> local round trip", () => {
    expect(utcIsoToBaLocal("2027-01-01T02:30:00Z")).toEqual({
      date: "2026-12-31",
      time: "23:30",
    });
    expect(utcIsoToBaLocal(null)).toBeNull();
    expect(utcIsoToBaLocal("garbage")).toBeNull();
  });
});

describe("groupIssues", () => {
  it("groups by type with Spanish labels and file names, counts truncated", () => {
    const json = JSON.stringify([
      { type: "missing_web", set: "Fiesta", name: "IMG_2" },
      { type: "missing_web", set: null, name: "IMG_1" },
      { type: "not_jpeg", set: null, name: "a.png" },
      { truncated: 7 },
    ]);
    const g = groupIssues(json);
    expect(g.truncated).toBe(7);
    expect(g.total).toBe(10);
    const web = g.groups.find((x) => x.type === "missing_web")!;
    expect(web.label).toMatch(/web/i);
    expect(web.items).toEqual([
      { set: "Fiesta", name: "IMG_2" },
      { set: null, name: "IMG_1" },
    ]);
    expect(g.groups.find((x) => x.type === "not_jpeg")!.label).toMatch(/JPEG/);
  });
  it("tolerates null, corrupt and unknown entries", () => {
    expect(groupIssues(null)).toEqual({ groups: [], truncated: 0, total: 0 });
    expect(groupIssues("{oops")).toEqual({
      groups: [],
      truncated: 0,
      total: 0,
    });
    const g = groupIssues(
      JSON.stringify([{ type: "weird", set: null, name: "x" }, 4]),
    );
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0].label).toBeTruthy();
  });
});

const P = (id: string, name: string, takenAt: string | null = null) => ({
  id,
  name,
  takenAt,
});

describe("sortPhotos", () => {
  const ps = [
    P("a", "IMG_10", "2026-01-01T10:00:00Z"),
    P("b", "IMG_2", null),
    P("c", "IMG_1", "2026-01-01T09:00:00Z"),
  ];
  it("by capture date: dated first, ties/nulls by name", () => {
    expect(sortPhotos(ps, "date").map((p) => p.id)).toEqual(["c", "a", "b"]);
  });
  it("by name: natural, case-insensitive", () => {
    expect(sortPhotos(ps, "name").map((p) => p.id)).toEqual(["c", "b", "a"]);
  });
  it("does not mutate", () => {
    const copy = [...ps];
    sortPhotos(ps, "name");
    expect(ps).toEqual(copy);
  });
});

describe("movePhoto", () => {
  const ids = ["a", "b", "c", "d"];
  it("moves one step", () => {
    expect(movePhoto(ids, "b", "before")).toEqual(["b", "a", "c", "d"]);
    expect(movePhoto(ids, "b", "after")).toEqual(["a", "c", "b", "d"]);
  });
  it("clamps at the edges and handles start/end", () => {
    expect(movePhoto(ids, "a", "before")).toEqual(ids);
    expect(movePhoto(ids, "d", "after")).toEqual(ids);
    expect(movePhoto(ids, "c", "start")).toEqual(["c", "a", "b", "d"]);
    expect(movePhoto(ids, "b", "end")).toEqual(["a", "c", "d", "b"]);
  });
  it("unknown id is a no-op", () => {
    expect(movePhoto(ids, "zz", "before")).toEqual(ids);
  });
});
