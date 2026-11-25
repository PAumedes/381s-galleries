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
  | "highres_empty";
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
  highres: DriveFile;
  web?: DriveFile;
  ig?: DriveFile;
  thumb?: DriveFile;
  wm?: DriveFile;
  thumbWm?: DriveFile;
  width: number | null;
  height: number | null;
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
}

type Winner = Located & { base: string };
type ByRecipe = Map<Recipe, Map<string, Winner>>;

/**
 * Winning file per recipe and (set, base name): the newest modifiedTime, then
 * the lowest id. Non-JPEG files and duplicates are reported into `issues`.
 */
function pickWinners(located: Located[], issues: SyncIssue[]): ByRecipe {
  const byRecipe: ByRecipe = new Map();
  const groups = new Map<string, Winner[]>();
  for (const l of located) {
    if (!isJpeg(l.file)) {
      issues.push({ type: "not_jpeg", set: l.set, name: l.file.name });
      continue;
    }
    const base = baseNameOf(l.file.name);
    const k = `${l.recipe}\0${l.set.toLowerCase()}\0${base.toLowerCase()}`;
    const g = groups.get(k) ?? [];
    g.push({ ...l, base });
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
      issues.push({ type: "duplicate", set: w.set, name: w.base });
    const m = byRecipe.get(w.recipe) ?? new Map();
    m.set(`${w.set.toLowerCase()}\0${w.base.toLowerCase()}`, w);
    byRecipe.set(w.recipe, m);
  }
  return byRecipe;
}

/** Pixel size of a photo: the high-res's, else scaled from the first sibling that has one. */
function sizeOfPhoto(h: DriveFile, siblings: (DriveFile | undefined)[]) {
  if (h.width && h.height) return { width: h.width, height: h.height };
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
  const web = pick("web");
  const ig = pick("ig");
  const thumb = pick("thumb");
  const wm = pick("preview-wm");
  const thumbWm = pick("thumb-wm");
  if (!web) issues.push({ type: "missing_web", set: h.set, name: h.base });
  if (!thumb) issues.push({ type: "missing_thumb", set: h.set, name: h.base });
  return {
    setName: h.set,
    baseName: h.base,
    highres: h.file,
    web,
    ig,
    thumb,
    wm,
    thumbWm,
    ...sizeOfPhoto(h.file, [web, ig, thumb, wm, thumbWm]),
  };
}

/** Each issue once, sorted by type, set, name. */
function uniqueSortedIssues(issues: SyncIssue[]): SyncIssue[] {
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

export function buildAlbum(
  folder: DriveFile,
  located: Located[],
  issues: SyncIssue[],
  hasWm: boolean,
): AlbumDraft {
  const byRecipe = pickWinners(located, issues);
  const hi = byRecipe.get("high-res") ?? new Map();
  const photos = [...hi].map(([key, h]) =>
    draftPhoto(h, key, byRecipe, issues),
  );
  for (const r of RECIPES) {
    if (r === "high-res") continue;
    for (const [key, v] of byRecipe.get(r) ?? [])
      if (!hi.has(key))
        issues.push({ type: "missing_highres", set: v.set, name: v.base });
  }
  return { folder, hasWm, photos, issues: uniqueSortedIssues(issues) };
}

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
