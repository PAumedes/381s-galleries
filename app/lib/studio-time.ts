// Studio time helpers shared by the admin pages (server and client).
//
// The studio timezone is an IANA name (env TIMEZONE, default Buenos Aires),
// resolved with Intl so DST zones work. Every function takes the zone as an
// optional last argument; an invalid or empty name falls back to the default.
//
// Local wall-clock -> UTC rule (deterministic around DST changes):
//  - a nonexistent time (spring-forward gap) moves forward by the gap, i.e. it
//    is read with the offset in force before the change (02:30 -> 03:30);
//  - an ambiguous time (fall-back overlap) takes the first occurrence, i.e.
//    the earlier instant (the offset before the change).

export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The IANA name if Intl accepts it, else the default (never throws). */
export function validTimezone(tz: unknown): string {
  if (typeof tz !== "string" || !tz.trim()) return DEFAULT_TIMEZONE;
  const name = tz.trim();
  try {
    formatter(name);
    return name;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** True for a real calendar date `YYYY-MM-DD`. */
export function isValidDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return (
    d.getUTCFullYear() === +m[1] &&
    d.getUTCMonth() === +m[2] - 1 &&
    d.getUTCDate() === +m[3]
  );
}

/** Local wall-clock of an instant, read as if it were UTC (ms). */
function wallAsUtcMs(t: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const x of formatter(tz).formatToParts(new Date(t)))
    if (x.type !== "literal") p[x.type] = +x.value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

const offsetMs = (t: number, tz: string) =>
  wallAsUtcMs(t - (t % 1000), tz) - (t - (t % 1000));

/** UTC ISO -> studio `{date: YYYY-MM-DD, time: HH:MM:SS}` (null if invalid). */
export function studioParts(
  iso: string | null | undefined,
  tz: string = DEFAULT_TIMEZONE,
): { date: string; time: string } | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  const s = new Date(wallAsUtcMs(t, validTimezone(tz))).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 19) };
}

/** UTC ISO -> `DD/MM/YYYY HH:MM` in studio time; "" if invalid. */
export function fmtStudio(
  iso: string | null | undefined,
  tz: string = DEFAULT_TIMEZONE,
): string {
  const p = studioParts(iso, tz);
  if (!p) return "";
  const [y, m, d] = p.date.split("-");
  return `${d}/${m}/${y} ${p.time.slice(0, 5)}`;
}

/** UTC ISO -> studio `{date, time: HH:MM}` (null for null/unparseable). */
export function utcIsoToLocal(
  iso: string | null | undefined,
  tz: string = DEFAULT_TIMEZONE,
): { date: string; time: string } | null {
  const p = studioParts(iso, tz);
  return p ? { date: p.date, time: p.time.slice(0, 5) } : null;
}

/** Studio wall-clock date + time -> UTC `YYYY-MM-DDTHH:MM:SSZ` (null if invalid). */
export function localToUtcIso(
  date: string,
  time: string,
  tz: string = DEFAULT_TIMEZONE,
): string | null {
  const m = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!m || !t || !isValidDate(date)) return null;
  const h = +t[1];
  const min = +t[2];
  if (h > 23 || min > 59) return null;
  const zone = validTimezone(tz);
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], h, min);
  // Offsets in force a day before / after bracket any single DST change.
  const before = offsetMs(wall - DAY_MS, zone);
  const after = offsetMs(wall + DAY_MS, zone);
  const candidates = [wall - before, wall - after].filter(
    (c) => wallAsUtcMs(c, zone) === wall,
  );
  // Overlap: earliest of the two; gap: none match, use the pre-change offset.
  const ms = candidates.length ? Math.min(...candidates) : wall - before;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}
