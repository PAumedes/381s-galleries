/**
 * Everything we record about a visitor's request, collected in ONE place and
 * shared by view and download logging. Owner decision: raw IP addresses are
 * never stored; the IP only ever becomes a keyed one-way hash. Every value is
 * hostile input (headers, `request.cf`): typed, stripped of control
 * characters and length-capped here, and the DB has CHECKs as a second wall.
 */
import { wellFormed } from "../text";
import { hashIp } from "./crypto";
import { clientIpHash, type AccessEnv } from "./access";
import { parseUserAgent, type Device } from "./user-agent";

/** Caps mirrored by the CHECKs of migration 0018. */
export const CAPS = {
  region: 100,
  city: 100,
  timezone: 64,
  asOrg: 100,
  lang: 35,
  referrerHost: 253,
  /** The raw User-Agent kept in `downloads.ua`. */
  ua: 200,
} as const;
const MAX_ASN = 4294967295;
const MAX_HEADER = 2048;

export interface VisitorInfo {
  country: string | null;
  ipHash: string | null;
  region: string | null;
  city: string | null;
  continent: string | null;
  timezone: string | null;
  asn: number | null;
  asOrg: string | null;
  lang: string | null;
  referrerHost: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  device: Device;
}

/** Control and bidi/invisible format characters (tab, CR and LF are turned into spaces first). */
const STRIP = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/** A string with control characters removed, whitespace collapsed and at most `max` characters; null if not a string or empty. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  let s = wellFormed(v.slice(0, max * 4 + 16))
    .replace(/[\t\n\r]+/g, " ")
    .replace(STRIP, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  // Never cut a surrogate pair in half.
  if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1);
  s = s.trim();
  return s || null;
}

/** Two-character code (country, continent) upper-cased; anything else is null. */
const upperCode = (v: unknown): string | null =>
  typeof v === "string" && /^[A-Za-z0-9]{2}$/.test(v) ? v.toUpperCase() : null;

/** First tag of Accept-Language (`es-AR,es;q=0.9` -> `es-AR`), strictly validated. */
export function primaryLanguage(
  header: string | null | undefined,
): string | null {
  if (typeof header !== "string") return null;
  const first = header
    .slice(0, MAX_HEADER)
    .split(",", 1)[0]
    .split(";", 1)[0]
    .trim();
  if (first.length > CAPS.lang) return null;
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(first) ? first : null;
}

/**
 * Host (only) of a Referer; null when missing, malformed, not http(s), an IP
 * address, or the site itself.
 */
export function referrerHost(
  referer: string | null | undefined,
  siteHosts: string | readonly string[],
): string | null {
  if (typeof referer !== "string" || !referer) return null;
  let host: string;
  try {
    const u = new URL(referer.slice(0, MAX_HEADER));
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || host.length > CAPS.referrerHost) return null;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)) return null;
  // A numeric last label is an IPv4 address (no TLD is numeric): never store IPs.
  if (/(?:^|\.)\d+$/.test(host)) return null;
  const own = typeof siteHosts === "string" ? [siteHosts] : siteHosts;
  return own.some((s) => s.toLowerCase() === host) ? null : host;
}

const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_ASN
    ? v
    : null;

type CfProps = Partial<Record<string, unknown>>;

/** The visitor's raw User-Agent as stored in `downloads.ua` (cleaned, capped). */
export const rawUserAgent = (request: Request): string | null =>
  cleanText(
    scrubIps(request.headers.get("User-Agent")?.slice(0, MAX_HEADER)),
    CAPS.ua,
  );

const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
// Any run of hex groups with at least two colons (covers `::`, `::1`, full and v4-mapped forms).
const IPV6 =
  /(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?:\.\d{1,3}){0,3}(?![\w:])/gi;

/** Replaces IPv4/IPv6 literals with "[ip]": the UA is stored raw and some clients/proxies embed the address. */
function scrubIps(v: string | null | undefined): string | null | undefined {
  return typeof v === "string"
    ? v.replace(IPV6, "[ip]").replace(IPV4, "[ip]")
    : v;
}

export async function visitorInfo(
  request: Request,
  env: AccessEnv & { PUBLIC_ORIGIN?: string },
  galleryId: string,
): Promise<VisitorInfo> {
  const cf: CfProps = (request as { cf?: CfProps }).cf ?? {};
  const own = [new URL(request.url).hostname];
  try {
    if (env.PUBLIC_ORIGIN) own.push(new URL(env.PUBLIC_ORIGIN).hostname);
  } catch {
    /* a bad PUBLIC_ORIGIN just means no second own host */
  }
  const ua = parseUserAgent(request.headers.get("User-Agent"));
  // Stored hash is salted per gallery so one visitor cannot be linked across galleries.
  const base = await clientIpHash(request, env, { prefix64: true });
  return {
    country: upperCode(cf.country),
    ipHash: base
      ? await hashIp(`${galleryId}:${base}`, env.SESSION_SECRET)
      : null,
    region: cleanText(cf.region ?? cf.regionCode, CAPS.region),
    city: cleanText(cf.city, CAPS.city),
    continent: upperCode(cf.continent),
    timezone: cleanText(cf.timezone, CAPS.timezone),
    asn: asNumber(cf.asn),
    asOrg: cleanText(cf.asOrganization, CAPS.asOrg),
    lang: primaryLanguage(request.headers.get("Accept-Language")),
    referrerHost: referrerHost(request.headers.get("Referer"), own),
    ...ua,
  };
}
