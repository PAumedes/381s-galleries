/**
 * Tiny User-Agent parser: a few `indexOf` scans over short ordered lists, no
 * regexes over the input, no dependency (cheap enough for the Workers free
 * plan). It only ever returns fixed names and digits, so its output is safe to
 * store and show as is.
 */

export const DEVICES = [
  "mobile",
  "tablet",
  "desktop",
  "bot",
  "unknown",
] as const;
export type Device = (typeof DEVICES)[number];

export interface ParsedUserAgent {
  browser: string | null;
  /** Major version, digits only. */
  browserVersion: string | null;
  os: string | null;
  device: Device;
}

/** Only the head of the header is looked at (in-app browsers append their tag late, but never past this). */
const MAX_UA = 512;
const MAX_VERSION_DIGITS = 4;

/** Ordered: the first token found wins (in-app and derived browsers before Chrome/Safari). */
const BROWSERS: ReadonlyArray<readonly [token: string, name: string]> = [
  ["Instagram ", "Instagram"],
  ["WhatsApp/", "WhatsApp"],
  ["FBAV/", "Facebook"],
  ["EdgA/", "Edge"],
  ["EdgiOS/", "Edge"],
  ["Edg/", "Edge"],
  ["Edge/", "Edge"],
  ["OPR/", "Opera"],
  ["OPiOS/", "Opera"],
  ["SamsungBrowser/", "Samsung Internet"],
  ["FxiOS/", "Firefox"],
  ["Firefox/", "Firefox"],
  ["CriOS/", "Chrome"],
  ["Chrome/", "Chrome"],
];

/** Lower-case substrings that mark automated clients and link-preview fetchers. */
const BOT_MARKERS = [
  "bot",
  "spider",
  "crawl",
  "slurp",
  "facebookexternalhit",
  "preview",
  "headless",
  "curl/",
  "wget/",
  "python-",
  "httpclient",
];

/** Major version following `token`: 1-4 digits, then a non-digit or the end. */
function majorAfter(ua: string, token: string): string | null {
  const at = ua.indexOf(token);
  if (at < 0) return null;
  let end = at + token.length;
  const start = end;
  while (
    end < ua.length &&
    ua.charCodeAt(end) >= 48 &&
    ua.charCodeAt(end) <= 57
  )
    end++;
  const n = end - start;
  return n >= 1 && n <= MAX_VERSION_DIGITS ? ua.slice(start, end) : null;
}

function detectBrowser(
  ua: string,
): Pick<ParsedUserAgent, "browser" | "browserVersion"> {
  for (const [token, name] of BROWSERS) {
    if (ua.includes(token)) {
      // Facebook's tag is FBAV/<version>; the version follows the same token.
      return { browser: name, browserVersion: majorAfter(ua, token) };
    }
  }
  if (ua.includes("Safari/") && ua.includes("Version/"))
    return { browser: "Safari", browserVersion: majorAfter(ua, "Version/") };
  return { browser: null, browserVersion: null };
}

function detectOs(ua: string): string | null {
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("iPhone") || ua.includes("iPad") || ua.includes("iPod"))
    return "iOS";
  if (ua.includes("CrOS")) return "ChromeOS";
  if (ua.includes("Macintosh") || ua.includes("Mac OS X")) return "macOS";
  if (ua.includes("Linux") || ua.includes("X11")) return "Linux";
  return null;
}

function detectDevice(ua: string, os: string | null, isBot: boolean): Device {
  if (isBot) return "bot";
  if (ua.includes("iPad") || ua.includes("Tablet")) return "tablet";
  if (os === "Android") return ua.includes("Mobile") ? "mobile" : "tablet";
  if (os === "iOS" || ua.includes("Mobi")) return "mobile";
  if (os === "Windows" || os === "macOS" || os === "Linux" || os === "ChromeOS")
    return "desktop";
  return "unknown";
}

export function parseUserAgent(
  raw: string | null | undefined,
): ParsedUserAgent {
  const ua = typeof raw === "string" ? raw.slice(0, MAX_UA).trim() : "";
  if (!ua)
    return { browser: null, browserVersion: null, os: null, device: "unknown" };
  const lower = ua.toLowerCase();
  // A bare "WhatsApp/x" agent is the link-preview fetcher, not a person.
  const isBot =
    BOT_MARKERS.some((m) => lower.includes(m)) || ua.startsWith("WhatsApp/");
  const os = detectOs(ua);
  return { ...detectBrowser(ua), os, device: detectDevice(ua, os, isBot) };
}
