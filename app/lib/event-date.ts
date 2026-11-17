/** Event date (`YYYY-MM-DD`) as a long date in `lang`, in UTC; null when missing or invalid. */
export function formatEventDate(
  value: string | null,
  lang: string,
): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(lang, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}
