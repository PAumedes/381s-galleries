// Buenos Aires time helpers shared by the admin pages (server and client).
// Argentina has no DST: America/Argentina/Buenos_Aires is a fixed UTC-3.

export const BA_OFFSET_MS = 3 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

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

/** UTC ISO -> Buenos Aires `{date: YYYY-MM-DD, time: HH:MM:SS}` (null if invalid). */
export function baParts(
  iso: string | null | undefined,
): { date: string; time: string } | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  const s = new Date(t - BA_OFFSET_MS).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 19) };
}

/** UTC ISO -> `DD/MM/YYYY HH:MM` in Buenos Aires; "" if invalid. */
export function fmtBa(iso: string | null | undefined): string {
  const p = baParts(iso);
  if (!p) return "";
  const [y, m, d] = p.date.split("-");
  return `${d}/${m}/${y} ${p.time.slice(0, 5)}`;
}

/** UTC ISO -> Buenos Aires `{date, time: HH:MM}` (null for null/unparseable). */
export function utcIsoToBaLocal(
  iso: string | null | undefined,
): { date: string; time: string } | null {
  const p = baParts(iso);
  return p ? { date: p.date, time: p.time.slice(0, 5) } : null;
}

/** Buenos Aires wall-clock date + time -> UTC `YYYY-MM-DDTHH:MM:SSZ` (null if invalid). */
export function baLocalToUtcIso(date: string, time: string): string | null {
  const m = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!m || !t || !isValidDate(date)) return null;
  const h = +t[1];
  const min = +t[2];
  if (h > 23 || min > 59) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], h, min) + BA_OFFSET_MS;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}
