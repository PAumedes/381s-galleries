/** True when `expiresAt` is set and is at/before `now`. Unparseable → expired. */
export function isExpired(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (expiresAt === null || expiresAt === undefined || expiresAt === "") {
    return false;
  }
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) || t <= now;
}
