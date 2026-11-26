/**
 * Pure helpers of the Drive -> D1 sync (PLAN §5.1): folder/file naming rules,
 * album building from located files, issue capping, pending-delete parsing.
 * No D1, R2 or Drive access here.
 */
import { FOLDER_MIME, SHORTCUT_MIME } from "./drive-types";
import type { DriveFile } from "./drive-types";

export const DEFAULT_SET = "Highlights";
export const RECIPES = [
  "high-res",
  "web",
  "ig",
  "thumb",
  "preview-wm",
  "thumb-wm",
  "tiff",
] as const;
export type Recipe = (typeof RECIPES)[number];
export const ISSUES_CAP = 200;
export type IssueType =
  | "unknown_folder"
  | "stray_file"
  | "not_jpeg"
  | "duplicate"
  | "missing_highres"
  | "missing_web"
  | "missing_thumb"
  | "highres_empty"
  | "version_conflict";
export interface SyncIssue {
  type: IssueType;
  set: string | null;
  name: string;
}

export const nfc = (s: string) => s.normalize("NFC").trim();
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Splits a leading date off an album folder name ("2026-11-14 Boda",
 * "2026-11-14_Boda", "2026-11-14 - Boda", "20261114 Boda"). Invalid calendar
 * dates and date-only names are left untouched.
 */
export function parseFolderDate(name: string): {
  title: string;
  eventDate: string | null;
} {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})(?:\s*[-_]\s*|[\s_]+)(\S.*)$/u.exec(
    name,
  );
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === mo - 1 &&
      dt.getUTCDate() === d
    )
      return { title: m[4].trim(), eventDate: `${m[1]}-${m[2]}-${m[3]}` };
  }
  return { title: name, eventDate: null };
}

export const isFolder = (f: DriveFile) => f.mimeType === FOLDER_MIME;
export const isLive = (f: DriveFile) =>
  !f.trashed && f.mimeType !== SHORTCUT_MIME;
export const isJpeg = (f: DriveFile) =>
  f.mimeType === "image/jpeg" || /\.jpe?g$/i.test(f.name);

/** A TIFF file (T6.53d): by MIME type or by extension, whatever the case. */
export const isTiff = (f: DriveFile) =>
  f.mimeType === "image/tiff" || /\.tiff?$/i.test(f.name);

export function baseNameOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return nfc(dot > 0 ? filename.slice(0, dot) : filename);
}
export const recipeOf = (name: string): Recipe | undefined =>
  RECIPES.find((r) => r === nfc(name).toLowerCase());

// ---------------------------------------------------------------- scanning

export interface PhotoDraft {
  setName: string;
  baseName: string;
  /** The photo's original: the JPEG high-res, or the TIFF of a TIFF-only photo. */
  highres: DriveFile;
  /** TIFF original (T6.53d); when there is no JPEG high-res it is also `highres`. */
  tiff?: DriveFile;
  web?: DriveFile;
  ig?: DriveFile;
  thumb?: DriveFile;
  wm?: DriveFile;
  thumbWm?: DriveFile;
  width: number | null;
  height: number | null;
  /** Versioned albums (T6.53b): the `v<N>/` round folder this version came from. */
  round?: number;
  /** Versioned albums: every version, ascending; the fields above are the latest's. */
  versions?: VersionDraft[];
}

/** One version of a photo in a versioned album (a PhotoDraft without `versions`). */
export interface VersionDraft {
  version: number;
  draft: PhotoDraft;
}

export interface AlbumDraft {
  folder: DriveFile;
  hasWm: boolean;
  photos: PhotoDraft[];
  issues: SyncIssue[];
}

export interface Located {
  recipe: Recipe;
  set: string;
  file: DriveFile;
  /** `v<N>/` round folder the file was found in (versioned albums only). */
  round?: number;
  /** Base name override: the name without its `_v<N>` suffix (versioned albums only). */
  base?: string;
  /** Name shown in issues: the file's own stem (versioned albums: `IMG_v3`, not `IMG`). */
  label?: string;
}

type Winner = Located & { base: string };
type ByRecipe = Map<Recipe, Map<string, Winner>>;

/**
 * The recipe a located file counts as, or null when it is not an image we
 * accept there. TIFFs are accepted in `tiff/` and `high-res/` (by extension or
 * MIME type) and count as `tiff`; everything else must be a JPEG, and `tiff/`
 * holds TIFFs only.
 */
function acceptedRecipe(l: Located): Recipe | null {
  if (isTiff(l.file) && (l.recipe === "tiff" || l.recipe === "high-res"))
    return "tiff";
  return l.recipe !== "tiff" && isJpeg(l.file) ? l.recipe : null;
}

/**
 * Winning file per recipe and (set, base name): the newest modifiedTime, then
 * the lowest id. Non-JPEG files and duplicates are reported into `issues`.
 */
function pickWinners(located: Located[], issues: SyncIssue[]): ByRecipe {
  const byRecipe: ByRecipe = new Map();
  const groups = new Map<string, Winner[]>();
  for (const l of located) {
    const recipe = acceptedRecipe(l);
    if (!recipe) {
      issues.push({ type: "not_jpeg", set: l.set, name: l.file.name });
      continue;
    }
    const base = l.base ?? baseNameOf(l.file.name);
    const k = `${recipe}\0${l.set.toLowerCase()}\0${base.toLowerCase()}`;
    const g = groups.get(k) ?? [];
    g.push({ ...l, recipe, base });
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    g.sort(
      (a, b) =>
        cmp(b.file.modifiedTime, a.file.modifiedTime) ||
        cmp(a.file.id, b.file.id),
    );
    const w = g[0];
    if (g.length > 1)
      issues.push({
        type: "duplicate",
        set: w.set,
        name: w.label ?? w.base,
      });
    const m = byRecipe.get(w.recipe) ?? new Map();
    m.set(`${w.set.toLowerCase()}\0${w.base.toLowerCase()}`, w);
    byRecipe.set(w.recipe, m);
  }
  return byRecipe;
}

/**
 * Pixel size of a photo: the high-res's, else scaled from the first sibling
 * that has one. `h` is undefined for a TIFF-only photo: browsers cannot show
 * a TIFF, so its size is never used (no preview = no dimensions).
 */
function sizeOfPhoto(
  h: DriveFile | undefined,
  siblings: (DriveFile | undefined)[],
) {
  if (h?.width && h?.height) return { width: h.width, height: h.height };
  const alt = siblings.find((f) => f?.width && f?.height);
  if (!alt) return { width: null, height: null };
  const k = 2048 / Math.max(alt.width!, alt.height!);
  return {
    width: Math.round(alt.width! * k),
    height: Math.round(alt.height! * k),
  };
}

/** One photo from its high-res winner; reports the missing web / thumb files. */
function draftPhoto(
  h: Winner,
  key: string,
  byRecipe: ByRecipe,
  issues: SyncIssue[],
): PhotoDraft {
  const pick = (r: Recipe) => byRecipe.get(r)?.get(key)?.file;
  const tiff = pick("tiff");
  const web = pick("web");
  const ig = pick("ig");
  const thumb = pick("thumb");
  const wm = pick("preview-wm");
  const thumbWm = pick("thumb-wm");
  if (!web)
    issues.push({
      type: "missing_web",
      set: h.set,
      name: h.label ?? h.base,
    });
  if (!thumb)
    issues.push({
      type: "missing_thumb",
      set: h.set,
      name: h.label ?? h.base,
    });
  return {
    setName: h.set,
    baseName: h.base,
    highres: h.file,
    ...(tiff ? { tiff } : {}),
    web,
    ig,
    thumb,
    wm,
    thumbWm,
    ...sizeOfPhoto(h.file === tiff ? undefined : h.file, [
      web,
      ig,
      thumb,
      wm,
      thumbWm,
    ]),
    ...(h.round !== undefined ? { round: h.round } : {}),
  };
}

/** Each issue once, sorted by type, set, name. */
export function uniqueSortedIssues(issues: SyncIssue[]): SyncIssue[] {
  const seen = new Set<string>();
  return issues
    .filter((i) => {
      const k = `${i.type}\0${i.set}\0${i.name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort(
      (a, b) =>
        cmp(a.type, b.type) ||
        cmp(a.set ?? "", b.set ?? "") ||
        cmp(a.name, b.name),
    );
}

/** The photos of one set of located files (one version in versioned albums): high-res winners and their siblings; orphans become issues. */
export function draftPhotos(
  located: Located[],
  issues: SyncIssue[],
): PhotoDraft[] {
  const byRecipe = pickWinners(located, issues);
  const hi = byRecipe.get("high-res") ?? new Map();
  const tiff = byRecipe.get("tiff") ?? new Map();
  // A photo is a JPEG high-res, or a TIFF with no JPEG high-res (TIFF-only).
  const originals = new Map([...tiff, ...hi]);
  const photos = [...hi, ...[...tiff].filter(([key]) => !hi.has(key))].map(
    ([key]) => draftPhoto(originals.get(key)!, key, byRecipe, issues),
  );
  for (const r of RECIPES) {
    if (r === "high-res" || r === "tiff") continue;
    for (const [key, v] of byRecipe.get(r) ?? [])
      if (!originals.has(key))
        issues.push({
          type: "missing_highres",
          set: v.set,
          name: v.label ?? v.base,
        });
  }
  return photos;
}

export function buildAlbum(
  folder: DriveFile,
  located: Located[],
  issues: SyncIssue[],
  hasWm: boolean,
): AlbumDraft {
  const photos = draftPhotos(located, issues);
  return { folder, hasWm, photos, issues: uniqueSortedIssues(issues) };
}

/** The `photos` columns one scanned photo (its latest version) writes. */
export const photoFields = (p: PhotoDraft) => ({
  setName: p.setName,
  baseName: p.baseName,
  driveHighresId: p.highres.id,
  driveWebId: p.web?.id ?? null,
  driveIgId: p.ig?.id ?? null,
  driveThumbId: p.thumb?.id ?? null,
  driveWmId: p.wm?.id ?? null,
  driveThumbWmId: p.thumbWm?.id ?? null,
  driveTiffId: p.tiff?.id ?? null,
  // What the high-res download serves: the TIFF when there is one.
  highresBytes: (p.tiff ?? p.highres).size ?? null,
  variantVersions: JSON.stringify({
    highres: p.highres.modifiedTime,
    web: p.web?.modifiedTime ?? null,
    ig: p.ig?.modifiedTime ?? null,
    thumb: p.thumb?.modifiedTime ?? null,
    wm: p.wm?.modifiedTime ?? null,
    thumbWm: p.thumbWm?.modifiedTime ?? null,
    // Only with a TIFF, so every other photo's JSON stays byte for byte.
    ...(p.tiff ? { tiff: p.tiff.modifiedTime } : {}),
  }),
  width: p.width,
  height: p.height,
  takenAt: p.highres.takenAt ?? null,
});

export const keyOf = (set: string, base: string) =>
  `${set.toLowerCase()}\0${base.toLowerCase()}`;

export const chunk = <T>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) =>
    a.slice(i * n, (i + 1) * n),
  );

export function capIssues(issues: SyncIssue[]): string {
  if (issues.length <= ISSUES_CAP) return JSON.stringify(issues);
  return JSON.stringify([
    ...issues.slice(0, ISSUES_CAP),
    { truncated: issues.length - ISSUES_CAP },
  ]);
}

export function parsePending(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export const issueCmp = (a: SyncIssue, b: SyncIssue) =>
  cmp(a.type, b.type) || cmp(a.set ?? "", b.set ?? "") || cmp(a.name, b.name);
