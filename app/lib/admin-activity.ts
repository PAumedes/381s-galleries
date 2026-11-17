// Pure helpers for the admin Activity / Favorites views and the CSV / txt
// exports (safe to import from client components).

import { baParts } from "./ba-time";

export { fmtBa } from "./ba-time";

export const CSV_BOM = "﻿";

/** One CSV cell: formula-injection guard (leading apostrophe) + RFC 4180 quoting. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(
  cells: ReadonlyArray<string | number | null | undefined>,
) {
  return cells.map(csvCell).join(",") + "\r\n";
}

/** UTC ISO -> `YYYY-MM-DD HH:MM:SS` in Buenos Aires; "" if invalid. */
export function fmtBaSeconds(iso: string | null | undefined): string {
  const p = baParts(iso);
  return p ? `${p.date} ${p.time}` : "";
}

export function stripExt(name: string): string {
  return name.replace(/\.(jpe?g|png|tiff?|webp)$/i, "");
}

/** Capture One filter string; names that cannot be quoted safely (`"`, or `,` in comma mode) are returned in `skipped`. */
export function captureOneResult(
  names: readonly string[],
  sep: "space" | "comma",
): { text: string; skipped: string[] } {
  const uniq = [...new Set(names.map(stripExt))];
  const skipped: string[] = [];
  const ok: string[] = [];
  for (const n of uniq) {
    if (n.includes('"') || (sep === "comma" && n.includes(",")))
      skipped.push(n);
    else ok.push(n);
  }
  const text =
    sep === "comma"
      ? ok.join(",")
      : ok.map((n) => (/\s/.test(n) ? `"${n}"` : n)).join(" ");
  return { text, skipped };
}

/** Names for Capture One's filter box: no extension, deduped, space (quoted if needed) or comma separated. */
export function captureOneString(
  names: readonly string[],
  sep: "space" | "comma",
): string {
  return captureOneResult(names, sep).text;
}

/** One base name per line (deduped), trailing newline; "" when empty. */
export function namesTxt(names: readonly string[]): string {
  const uniq = [...new Set(names.map(stripExt))];
  return uniq.length ? uniq.join("\n") + "\n" : "";
}

export function anonLabel(visitorId: string): string {
  return `Anónimo #${visitorId.slice(0, 6)}`;
}

export const SIZE_LABELS: Record<string, string> = {
  highres: "Alta resolución",
  web: "Web",
  ig: "Instagram",
};

export function bulkTitle(scope: string | null, count: number): string {
  const what =
    scope === "all"
      ? "Todas"
      : scope === "favorites"
        ? "Favoritos"
        : scope?.startsWith("set:")
          ? `Set ${scope.slice(4)}`
          : "sin detalle";
  return `Descarga completa: ${what} (${count} ${count === 1 ? "foto" : "fotos"})`;
}
