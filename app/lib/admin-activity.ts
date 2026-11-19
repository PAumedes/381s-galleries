// Pure helpers for the admin Activity / Favorites views and the CSV / txt
// exports (safe to import from client components).

import { es } from "../i18n/es";
import { makeT, type MessageKey, type TFunction } from "../i18n/t";
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

/** Spanish "Anónimo #abc123"; the admin UI builds it per language from `admin.anonId`. */
export function anonLabel(visitorId: string): string {
  return es["admin.anonId"].replace("{id}", visitorId.slice(0, 6));
}

/** Message key of each download size. */
export const SIZE_KEYS: Record<string, MessageKey> = {
  highres: "admin.size.highres",
  web: "admin.size.web",
  ig: "admin.size.ig",
};

/** "Descarga completa: Set X (3 fotos)" in the language of `t` (Spanish by default). */
export function bulkTitle(
  scope: string | null,
  count: number,
  t: TFunction = makeT("es", es),
): string {
  const what =
    scope === "all"
      ? t("admin.activity.bulkAll")
      : scope === "favorites"
        ? t("admin.activity.bulkFavorites")
        : scope?.startsWith("set:")
          ? t("admin.activity.bulkSet", { name: scope.slice(4) })
          : t("admin.activity.bulkNone");
  return t("admin.activity.bulkTitle", {
    what,
    photos: t("admin.count.photos", { count }),
  });
}

/** What the Actividad tab shows about where / on what a visit came from. */
export interface VisitorDisplay {
  country: string | null;
  region: string | null;
  city: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  referrerHost: string | null;
  lang: string | null;
  device: string | null;
}

/** The display fields of any row that carries the visitor-info columns. */
export const visitorDisplay = (r: VisitorDisplay): VisitorDisplay => ({
  country: r.country,
  region: r.region,
  city: r.city,
  lang: r.lang,
  referrerHost: r.referrerHost,
  browser: r.browser,
  browserVersion: r.browserVersion,
  os: r.os,
  device: r.device,
});

const join = (parts: ReadonlyArray<string | null | undefined>, sep: string) =>
  parts.filter(Boolean).join(sep);

/** "Villa Luro, AR" (either part may be missing; "" when both are). */
export const placeLabel = (v: Pick<VisitorDisplay, "city" | "country">) =>
  join([v.city, v.country], ", ");

/** "Safari 17 · iOS". */
export const softwareLabel = (
  v: Pick<VisitorDisplay, "browser" | "browserVersion" | "os">,
) => join([join([v.browser, v.browserVersion], " "), v.os], " · ");

/** "l.instagram.com · es-AR". */
export const sourceLabel = (v: Pick<VisitorDisplay, "referrerHost" | "lang">) =>
  join([v.referrerHost, v.lang], " · ");

/** Message key of each device type. */
export const DEVICE_KEYS: Record<string, MessageKey> = {
  mobile: "admin.device.mobile",
  tablet: "admin.device.tablet",
  desktop: "admin.device.desktop",
  bot: "admin.device.bot",
  unknown: "admin.device.unknown",
};
