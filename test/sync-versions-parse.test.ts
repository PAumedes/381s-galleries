import { describe, expect, it } from "vitest";
import { buildAlbum } from "../app/lib/server/sync-helpers";
import type {
  Located,
  Recipe,
  SyncIssue,
} from "../app/lib/server/sync-helpers";
import { buildVersionedAlbum } from "../app/lib/server/sync-versions";
import type { DriveFile } from "../app/lib/server/drive-types";

let n = 0;
const file = (name: string, over: Partial<DriveFile> = {}): DriveFile => ({
  id: `f${String(++n).padStart(3, "0")}`,
  name,
  mimeType: "image/jpeg",
  modifiedTime: "2026-01-01T00:00:00Z",
  width: 2000,
  height: 1000,
  ...over,
});
const loc = (
  recipe: Recipe,
  name: string,
  over: { round?: number; set?: string } & Partial<DriveFile> = {},
): Located => {
  const { round, set = "Highlights", ...f } = over;
  return {
    recipe,
    set,
    file: file(name, f),
    ...(round !== undefined ? { round } : {}),
  };
};
const FOLDER = file("Album", {
  mimeType: "application/vnd.google-apps.folder",
});
const build = (located: Located[], issues: SyncIssue[] = []) =>
  buildVersionedAlbum(FOLDER, located, issues, false);
const only = (a: ReturnType<typeof build>, type: SyncIssue["type"]) =>
  a.issues.filter((i) => i.type === type);
const summary = (a: ReturnType<typeof build>) =>
  a.photos.map((p) => ({
    base: p.baseName,
    latest: p.highres.name,
    versions: p.versions?.map((v) => v.version),
  }));

describe("T6.53b version parsing: suffix `<base>_v<N>.<ext>` (versioned albums only)", () => {
  it("no suffix = v1, `_v2` = v2 of the SAME photo; the photo mirrors the latest version", () => {
    const hr1 = loc("high-res", "IMG_1.jpg");
    const hr2 = loc("high-res", "IMG_1_v2.jpg");
    const web2 = loc("web", "IMG_1_v2.jpg");
    const a = build([hr1, hr2, web2]);
    expect(a.photos).toHaveLength(1);
    const p = a.photos[0];
    expect(p.baseName).toBe("IMG_1");
    expect(p.highres.id).toBe(hr2.file.id);
    expect(p.web?.id).toBe(web2.file.id);
    expect(p.versions?.map((v) => v.version)).toEqual([1, 2]);
    expect(p.versions?.[0].draft.highres.id).toBe(hr1.file.id);
    expect(p.versions?.[0].draft.web).toBeUndefined();
  });

  it("`_v1` is v1 (same photo as the bare name's v1 slot)", () => {
    const a = build([
      loc("high-res", "IMG_1_v1.jpg"),
      loc("high-res", "IMG_1_v2.jpg"),
    ]);
    expect(summary(a)).toEqual([
      { base: "IMG_1", latest: "IMG_1_v2.jpg", versions: [1, 2] },
    ]);
  });

  it("is case-insensitive and groups by set, not across sets", () => {
    const a = build([
      loc("high-res", "IMG_1.JPG"),
      loc("high-res", "img_1_V3.jpg"),
      loc("high-res", "IMG_1_v2.jpg", { set: "Otro" }),
    ]);
    expect(
      a.photos
        .map((p) => [p.setName, p.versions?.map((v) => v.version)])
        .sort(),
    ).toEqual([
      ["Highlights", [1, 3]],
      ["Otro", [2]],
    ]);
  });

  it("a photo first delivered at v2 (no v1 file) is one photo with versions [2]", () => {
    const a = build([loc("high-res", "IMG_9_v2.jpg")]);
    expect(summary(a)).toEqual([
      { base: "IMG_9", latest: "IMG_9_v2.jpg", versions: [2] },
    ]);
  });

  it.each([
    "IMG_v0.jpg", // v0 is not a version
    "IMG_v02.jpg", // leading zero: not canonical
    "IMG_v1000.jpg", // out of range (1..999)
    "IMG_vx.jpg",
    "IMG_v.jpg",
    "_v2.jpg", // empty base
    "IMGv2.jpg", // no underscore
    "IMG_v2_final.jpg", // the suffix must end the base name
  ])("%s is NOT a version: a plain photo named after the file", (name) => {
    const a = build([loc("high-res", name)]);
    expect(a.photos).toHaveLength(1);
    expect(a.photos[0].baseName).toBe(name.replace(/\.jpg$/, ""));
    expect(a.photos[0].versions?.map((v) => v.version)).toEqual([1]);
  });

  it("only the last `_v<N>` counts: IMG_v2_v3 is v3 of `IMG_v2`", () => {
    const a = build([loc("high-res", "IMG_v2_v3.jpg")]);
    expect(summary(a)).toEqual([
      { base: "IMG_v2", latest: "IMG_v2_v3.jpg", versions: [3] },
    ]);
  });

  it("the latest version is the highest one that HAS a high-res; a lone web v3 is reported", () => {
    const a = build([
      loc("high-res", "A.jpg"),
      loc("high-res", "A_v2.jpg"),
      loc("web", "A_v3.jpg"),
    ]);
    expect(a.photos[0].highres.name).toBe("A_v2.jpg");
    expect(a.issues).toContainEqual({
      type: "missing_highres",
      set: "Highlights",
      name: "A_v3",
    });
  });

  it("each version is checked for its own web/thumb", () => {
    const a = build([
      loc("high-res", "A.jpg"),
      loc("web", "A.jpg"),
      loc("thumb", "A.jpg"),
      loc("high-res", "A_v2.jpg"),
    ]);
    expect(a.issues.map((i) => i.type)).toEqual([
      "missing_thumb",
      "missing_web",
    ]);
    expect(a.photos[0].web).toBeUndefined(); // mirrors v2, which has no web
  });

  it("duplicates are resolved per version (newest modified wins) and reported", () => {
    const old = loc("high-res", "A_v2.jpg", {
      modifiedTime: "2026-01-01T00:00:00Z",
    });
    const fresh = loc("high-res", "a_v2.jpg", {
      modifiedTime: "2026-02-01T00:00:00Z",
    });
    const a = build([loc("high-res", "A.jpg"), old, fresh]);
    expect(a.photos[0].highres.id).toBe(fresh.file.id);
    expect(a.issues.filter((i) => i.type === "duplicate")).toHaveLength(1);
  });

  it("non-JPEG files are still reported by their real name", () => {
    const a = build([
      loc("high-res", "A.jpg"),
      loc("high-res", "A_v2.png", { mimeType: "image/png" }),
    ]);
    expect(a.issues).toContainEqual({
      type: "not_jpeg",
      set: "Highlights",
      name: "A_v2.png",
    });
    expect(a.photos[0].versions?.map((v) => v.version)).toEqual([1]);
  });
});

describe("T6.53b version parsing: round folders `v<N>/`", () => {
  it("every file of a round folder is that version, same recipe layout", () => {
    const hr1 = loc("high-res", "IMG_1.jpg");
    const hr2 = loc("high-res", "IMG_1.jpg", { round: 2 });
    const web2 = loc("web", "IMG_1.jpg", { round: 2 });
    const a = build([hr1, hr2, web2]);
    expect(a.photos).toHaveLength(1);
    const p = a.photos[0];
    expect(p.highres.id).toBe(hr2.file.id);
    expect(p.web?.id).toBe(web2.file.id);
    expect(p.versions?.map((v) => v.version)).toEqual([1, 2]);
    expect(p.versions?.[1].draft.round).toBe(2);
    expect(p.versions?.[0].draft.round).toBeUndefined();
  });

  it("a suffix that agrees with the folder is fine and keeps the folder round", () => {
    const a = build([loc("high-res", "IMG_1_v2.jpg", { round: 2 })]);
    expect(only(a, "version_conflict")).toEqual([]);
    expect(a.photos[0].versions?.[0]).toMatchObject({
      version: 2,
      draft: { round: 2 },
    });
  });

  it("a suffix that contradicts the folder wins and is a version_conflict", () => {
    const a = build([loc("high-res", "IMG_1_v3.jpg", { round: 2 })]);
    expect(a.photos[0].versions?.map((v) => v.version)).toEqual([3]);
    expect(a.photos[0].versions?.[0].draft.round).toBeUndefined();
    expect(only(a, "version_conflict")).toEqual([
      { type: "version_conflict", set: "Highlights", name: "IMG_1_v3" },
    ]);
  });

  it("same recipe, set, base and version in the main folder (suffix) AND in v2/: suffix wins, conflict listed once", () => {
    const suffix = loc("high-res", "IMG_1_v2.jpg", {
      modifiedTime: "2026-01-01T00:00:00Z",
    });
    const folder = loc("high-res", "IMG_1.jpg", {
      round: 2,
      modifiedTime: "2026-03-01T00:00:00Z", // newer, still loses
    });
    const a = build([suffix, folder]);
    expect(a.photos[0].highres.id).toBe(suffix.file.id);
    expect(a.photos[0].versions?.[0].draft.round).toBeUndefined();
    expect(a.issues.filter((i) => i.type === "version_conflict")).toEqual([
      { type: "version_conflict", set: "Highlights", name: "IMG_1_v2" },
    ]);
    expect(a.issues.some((i) => i.type === "duplicate")).toBe(false);
  });

  it("conflict is per recipe: only the web in v2/ clashes, the high-res of v2/ stays", () => {
    const hr = loc("high-res", "IMG_1.jpg", { round: 2 });
    const webFolder = loc("web", "IMG_1.jpg", { round: 2 });
    const webSuffix = loc("web", "IMG_1_v2.jpg");
    const a = build([hr, webFolder, webSuffix]);
    expect(a.photos[0].highres.id).toBe(hr.file.id);
    expect(a.photos[0].web?.id).toBe(webSuffix.file.id);
    expect(a.issues.filter((i) => i.type === "version_conflict")).toHaveLength(
      1,
    );
  });

  it("an explicit v1 and a `v1/` folder file are a plain duplicate, not a conflict", () => {
    const a = build([
      loc("high-res", "IMG_1.jpg"),
      loc("high-res", "IMG_1.jpg", { round: 1 }),
    ]);
    expect(only(a, "duplicate")).toHaveLength(1);
    expect(only(a, "version_conflict")).toEqual([]);
  });
});

describe("T6.53b: unversioned albums are untouched", () => {
  it("buildAlbum keeps `IMG_v2` as its own plain photo, with no version fields", () => {
    const a = buildAlbum(
      FOLDER,
      [loc("high-res", "IMG_1.jpg"), loc("high-res", "IMG_1_v2.jpg")],
      [],
      false,
    );
    expect(a.photos.map((p) => p.baseName).sort()).toEqual([
      "IMG_1",
      "IMG_1_v2",
    ]);
    expect(a.photos.every((p) => p.versions === undefined)).toBe(true);
  });
});
