import { studioParts } from "../lib/studio-time";
import type { Lang } from "./lang";

/** Formatting locale per UI language. */
export function localeFor(lang: Lang): string {
  return lang === "en" ? "en" : "es-AR";
}

const DATE = {
  es: { day: "2-digit", month: "2-digit", year: "numeric" },
  en: { day: "numeric", month: "short", year: "numeric" },
} as const satisfies Record<Lang, Intl.DateTimeFormatOptions>;

const TIME = {
  es: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  en: { hour: "numeric", minute: "2-digit", hour12: true },
} as const satisfies Record<Lang, Intl.DateTimeFormatOptions>;

const dateFmt = (lang: Lang) =>
  new Intl.DateTimeFormat(localeFor(lang), { ...DATE[lang], timeZone: "UTC" });
const timeFmt = (lang: Lang) =>
  new Intl.DateTimeFormat(localeFor(lang), { ...TIME[lang], timeZone: "UTC" });

const PLAIN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` as a calendar date in `lang`; anything else is returned unchanged. */
export function fmtPlainDate(lang: Lang, date: string | null): string {
  const m = date ? PLAIN.exec(date) : null;
  if (!m) return date ?? "";
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return Number.isNaN(d.getTime()) ? date! : dateFmt(lang).format(d);
}

/** `HH:MM` wall-clock time in `lang`. */
function fmtWallTime(lang: Lang, hhmm: string): string {
  const [h = "0", m = "0"] = hhmm.split(":");
  return timeFmt(lang).format(new Date(Date.UTC(2000, 0, 1, +h, +m)));
}

/** Buenos Aires date + time of a UTC ISO instant ("" when invalid). */
export function fmtStudioDateTime(
  lang: Lang,
  iso: string | null | undefined,
): string {
  const p = studioParts(iso);
  if (!p) return "";
  const sep = lang === "en" ? ", " : " ";
  return `${fmtPlainDate(lang, p.date)}${sep}${fmtWallTime(lang, p.time.slice(0, 5))}`;
}

/** Buenos Aires wall-clock `YYYY-MM-DD` + `HH:MM` pair, formatted like fmtStudioDateTime. */
export function fmtLocalDateTime(
  lang: Lang,
  date: string,
  time: string,
): string {
  const sep = lang === "en" ? ", " : " ";
  return `${fmtPlainDate(lang, date)}${sep}${fmtWallTime(lang, time)}`;
}

export function fmtNumber(lang: Lang, n: number): string {
  return new Intl.NumberFormat(localeFor(lang)).format(n);
}
