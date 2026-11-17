import { applySecurityHeaders, makeNonce } from "./security-headers";
import { validPublicOrigin } from "./public-url";

/**
 * Old public hostnames (e.g. the pre-T6.8 `session.` host) redirect to
 * `PUBLIC_ORIGIN`. The target is PUBLIC_ORIGIN plus the request path and
 * query only: never the Host header, so it cannot become an open redirect.
 * A legacy host with an unusable PUBLIC_ORIGIN fails closed (421), it never
 * falls through to serve the app.
 */

/** Lowercase, one trailing dot removed (FQDN form). */
const normHost = (h: string) => h.toLowerCase().replace(/\.$/, "");

function finish(res: Response): Response {
  return applySecurityHeaders(res, { nonce: makeNonce(), mock: false });
}

/** Paths and queries that must never be cached (admin, OAuth callback). */
function sensitive(url: URL): boolean {
  const p = url.pathname.toLowerCase();
  if (p === "/admin" || p.startsWith("/admin/")) return true;
  if (p === "/api/admin" || p.startsWith("/api/admin/")) return true;
  return url.searchParams.has("code") || url.searchParams.has("state");
}

export function legacyRedirect(
  request: Request,
  env: { PUBLIC_ORIGIN?: string; LEGACY_HOSTS?: string },
): Response | null {
  const hosts = (env.LEGACY_HOSTS ?? "")
    .split(",")
    .map((h) => normHost(h.trim()))
    .filter(Boolean);
  if (hosts.length === 0) return null;

  const url = new URL(request.url);
  if (!hosts.includes(normHost(url.hostname))) return null;

  const misdirected = () =>
    finish(
      new Response(null, {
        status: 421,
        headers: { "Cache-Control": "no-store" },
      }),
    );

  const origin = validPublicOrigin(env);
  // Never redirect a host to itself (would loop).
  if (!origin || hosts.includes(normHost(new URL(origin).hostname))) {
    return misdirected();
  }

  // "//evil.com" would parse as a protocol-relative URL: force a single "/".
  const path = "/" + url.pathname.replace(/^[/\\]+/, "");
  let target = new URL(path + url.search, origin);
  if (target.origin !== origin) target = new URL("/", origin);

  const safe = request.method === "GET" || request.method === "HEAD";
  return finish(
    new Response(null, {
      status: safe ? 301 : 308,
      headers: {
        Location: target.href,
        "Cache-Control": sensitive(url) ? "no-store" : "public, max-age=86400",
      },
    }),
  );
}
