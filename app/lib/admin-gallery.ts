// Pure helpers shared by the admin gallery list/edit pages (server and client).

import { es } from "../i18n/es";
import { fmtPlainDate } from "../i18n/format";
import type { Lang } from "../i18n/lang";
import type { MessageKey } from "../i18n/t";

export const FILTERS = [
  "todas",
  "publicadas",
  "borradores",
  "archivadas",
] as const;
export type Filter = (typeof FILTERS)[number];

/** Message key of each filter tab (the URL values stay Spanish). */
export const FILTER_KEYS: Record<Filter, MessageKey> = {
  todas: "admin.filter.todas",
  publicadas: "admin.filter.publicadas",
  borradores: "admin.filter.borradores",
  archivadas: "admin.filter.archivadas",
};

export function parseFilter(v: string | null | undefined): Filter {
  return (FILTERS as readonly string[]).includes(v ?? "")
    ? (v as Filter)
    : "todas";
}

// ----------------------------------------------------- Buenos Aires time
export { localToUtcIso, isValidDate, utcIsoToLocal } from "./studio-time";

/** `2026-11-01` -> `01/11/2026` (es) / `Nov 1, 2026` (en); unchanged when not a plain date. */
export function fmtDate(date: string | null, lang: Lang = "es"): string {
  return fmtPlainDate(lang, date);
}

// ----------------------------------------------------------- sync issues
/** Message key of each sync issue type. */
export const ISSUE_KEYS: Record<string, MessageKey> = {
  unknown_folder: "admin.issue.unknown_folder",
  stray_file: "admin.issue.stray_file",
  not_jpeg: "admin.issue.not_jpeg",
  duplicate: "admin.issue.duplicate",
  missing_highres: "admin.issue.missing_highres",
  missing_web: "admin.issue.missing_web",
  missing_thumb: "admin.issue.missing_thumb",
  highres_empty: "admin.issue.highres_empty",
  missing_wm: "admin.issue.missing_wm",
};

/** Spanish default labels (the UI translates `type` through ISSUE_KEYS). */
export const ISSUE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(ISSUE_KEYS).map(([type, key]) => [type, es[key]]),
);

export interface IssueGroup {
  type: string;
  label: string;
  items: { set: string | null; name: string }[];
}
export interface GroupedIssues {
  groups: IssueGroup[];
  truncated: number;
  total: number;
}

/** Parse `sync_issues_json` (tolerant) and group by type, keeping first-seen order. */
export function groupIssues(json: string | null | undefined): GroupedIssues {
  const out: GroupedIssues = { groups: [], truncated: 0, total: 0 };
  if (!json) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return out;
  }
  if (!Array.isArray(raw)) return out;
  const byType = new Map<string, IssueGroup>();
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (typeof o.truncated === "number" && !("type" in o)) {
      out.truncated += Math.max(0, Math.trunc(o.truncated));
      continue;
    }
    if (typeof o.type !== "string") continue;
    let g = byType.get(o.type);
    if (!g) {
      g = {
        type: o.type,
        label: Object.hasOwn(ISSUE_LABELS, o.type)
          ? ISSUE_LABELS[o.type]
          : es["admin.issue.other"],
        items: [],
      };
      byType.set(o.type, g);
      out.groups.push(g);
    }
    g.items.push({
      set: typeof o.set === "string" ? o.set : null,
      name: typeof o.name === "string" ? o.name : "",
    });
  }
  out.total =
    out.truncated + out.groups.reduce((n, g) => n + g.items.length, 0);
  return out;
}

// -------------------------------------------------------------- ordering
export interface SortablePhoto {
  id: string;
  name: string;
  takenAt: string | null;
}

const byName = (a: string, b: string) =>
  a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });

/** New array: "date" = capture time (undated last) then name; "name" = natural name order. */
export function sortPhotos<T extends SortablePhoto>(
  photos: readonly T[],
  mode: "date" | "name",
): T[] {
  return [...photos].sort((a, b) => {
    if (mode === "date") {
      if (a.takenAt && b.takenAt && a.takenAt !== b.takenAt)
        return a.takenAt < b.takenAt ? -1 : 1;
      if (a.takenAt && !b.takenAt) return -1;
      if (!a.takenAt && b.takenAt) return 1;
    }
    return byName(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

export type MoveDir = "before" | "after" | "start" | "end";

/** New id list with `id` moved one step / to an edge (no-op when unknown or already there). */
export function movePhoto(
  ids: readonly string[],
  id: string,
  dir: MoveDir,
): string[] {
  const i = ids.indexOf(id);
  if (i === -1) return [...ids];
  const to =
    dir === "before"
      ? Math.max(0, i - 1)
      : dir === "after"
        ? Math.min(ids.length - 1, i + 1)
        : dir === "start"
          ? 0
          : ids.length - 1;
  return moveTo(ids, i, to);
}

/** Remove the item at `from` and insert it at index `to`. */
export function moveTo(
  ids: readonly string[],
  from: number,
  to: number,
): string[] {
  const out = [...ids];
  if (from === to || from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}

/** Search key: accents stripped (NFD), lowercased, trimmed. */
export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}
