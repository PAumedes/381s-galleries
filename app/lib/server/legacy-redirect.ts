/**
 * Old public hostnames (e.g. the pre-T6.8 `session.` host) redirect to
 * `PUBLIC_ORIGIN`. The target is PUBLIC_ORIGIN plus the request path and
 * query only: never the Host header, so it cannot become an open redirect.
 */
export function legacyRedirect(
  request: Request,
  env: { PUBLIC_ORIGIN?: string; LEGACY_HOSTS?: string },
): Response | null {
  const hosts = (env.LEGACY_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0) return null;

  const url = new URL(request.url);
  if (!hosts.includes(url.hostname.toLowerCase())) return null;

  let origin: string;
  try {
    const o = new URL(env.PUBLIC_ORIGIN?.trim() ?? "");
    if (o.protocol !== "https:" && o.protocol !== "http:") return null;
    if (o.username || o.password) return null;
    origin = o.origin;
  } catch {
    return null;
  }
  // Never redirect a host to itself (would loop).
  if (hosts.includes(new URL(origin).hostname.toLowerCase())) return null;

  // "//evil.com" would parse as a protocol-relative URL: force a single "/".
  const path = "/" + url.pathname.replace(/^[/\\]+/, "");
  let target = new URL(path + url.search, origin);
  if (target.origin !== origin) target = new URL("/", origin);

  const safe = request.method === "GET" || request.method === "HEAD";
  return new Response(null, {
    status: safe ? 301 : 308,
    headers: {
      Location: target.href,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
