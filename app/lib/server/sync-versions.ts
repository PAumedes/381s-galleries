/**
 * Version parsing of a versioned album (T6.53b, PLAN T6.53 a): pure, no D1.
 *
 * A photo is one logical item (set + base name) with versions v1..vN. A file's
 * version comes from its name suffix `<base>_v<N>.<ext>` (primary; no suffix =
 * v1, `_v1` = v1) or, failing that, from the `v<N>/` round folder it sits in
 * (fallback; same recipe layout inside). The suffix wins on conflict and the
 * conflict is a `version_conflict` issue. Only albums with
 * `galleries.versioning = 1` go through here; every other album keeps its
 * names as they are (`IMG_v2` is then just a photo called `IMG_v2`).
 */
import {
  baseNameOf,
  draftPhotos,
  keyOf,
  uniqueSortedIssues,
} from "./sync-helpers";
import type {
  AlbumDraft,
  Located,
  PhotoDraft,
  SyncIssue,
  VersionDraft,
} from "./sync-helpers";
import type { DriveFile } from "./drive-types";

/** Versions are 1..999, canonical digits (`_v02`, `_v0` and `_v1000` are plain names). */
const SUFFIX = /^(.+)_v([1-9]\d{0,2})$/i;
/** A round folder: `v2`, `V3` (same range as the suffix). */
const ROUND_FOLDER = /^v([1-9]\d{0,2})$/i;

/** The round number of a `v<N>` folder name, or undefined. */
export const roundFolderNumber = (name: string): number | undefined => {
  const m = ROUND_FOLDER.exec(name.normalize("NFC").trim());
  return m ? Number(m[1]) : undefined;
};

type Layer = "suffix" | "folder" | "plain";

interface Parsed {
  located: Located;
  base: string;
  version: number;
  layer: Layer;
}

/** Version of one located file; a suffix contradicting its folder wins (reported). */
function parse(l: Located, issues: SyncIssue[]): Parsed {
  const stem = baseNameOf(l.file.name);
  const m = SUFFIX.exec(stem);
  if (!m)
    return {
      located: l,
      base: stem,
      version: l.round ?? 1,
      layer: l.round === undefined ? "plain" : "folder",
    };
  const version = Number(m[2]);
  let { round } = l;
  if (round !== undefined && round !== version) {
    issues.push({ type: "version_conflict", set: l.set, name: stem });
    round = undefined;
  }
  const { round: _drop, ...rest } = l;
  void _drop;
  return {
    located: round === undefined ? rest : { ...rest, round },
    base: m[1],
    version,
    layer: "suffix",
  };
}

/** Same recipe, set, base and version delivered by suffix AND by round folder: the suffix wins. */
function dropFolderClashes(parsed: Parsed[], issues: SyncIssue[]): Parsed[] {
  const key = (p: Parsed) =>
    `${p.located.recipe}\0${keyOf(p.located.set, p.base)}\0${p.version}`;
  const bySuffix = new Set(parsed.filter((p) => p.layer === "suffix").map(key));
  return parsed.filter((p) => {
    if (p.layer !== "folder" || !bySuffix.has(key(p))) return true;
    issues.push({
      type: "version_conflict",
      set: p.located.set,
      name: `${p.base}_v${p.version}`,
    });
    return false;
  });
}

/** One logical photo per (set, base): versions ascending, the photo's own fields are the latest's. */
function mergeVersions(byVersion: Map<number, PhotoDraft[]>): PhotoDraft[] {
  const logical = new Map<string, VersionDraft[]>();
  for (const version of [...byVersion.keys()].sort((a, b) => a - b))
    for (const draft of byVersion.get(version)!) {
      const k = keyOf(draft.setName, draft.baseName);
      logical.set(k, [...(logical.get(k) ?? []), { version, draft }]);
    }
  return [...logical.values()].map((versions) => ({
    ...versions[versions.length - 1].draft,
    setName: versions[0].draft.setName,
    baseName: versions[0].draft.baseName,
    versions,
  }));
}

export function buildVersionedAlbum(
  folder: DriveFile,
  located: Located[],
  issues: SyncIssue[],
  hasWm: boolean,
): AlbumDraft {
  const parsed = dropFolderClashes(
    located.map((l) => parse(l, issues)),
    issues,
  );
  const partitions = new Map<number, Located[]>();
  for (const p of parsed) {
    const part = partitions.get(p.version) ?? [];
    part.push({ ...p.located, base: p.base });
    partitions.set(p.version, part);
  }
  const byVersion = new Map<number, PhotoDraft[]>();
  for (const [version, part] of partitions)
    byVersion.set(version, draftPhotos(part, issues));
  return {
    folder,
    hasWm,
    photos: mergeVersions(byVersion),
    issues: uniqueSortedIssues(issues),
  };
}
