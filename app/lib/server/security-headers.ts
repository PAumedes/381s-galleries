import { b64urlEncode } from "./crypto";

/** Per-request CSP nonce: 128 random bits, base64url. */
export function makeNonce(): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

const PICSUM = "https://picsum.photos https://fastly.picsum.photos";

/** The site-wide Content-Security-Policy. `mock` (dev) also allows picsum images. */
export function buildCsp(nonce: string, mock: boolean): string {
  const picsum = mock ? ` ${PICSUM}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${picsum}`,
    `connect-src 'self'${picsum}`,
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self' https://accounts.google.com",
    "object-src 'none'",
  ].join("; ");
}

/**
 * Adds the security headers to every response (HTML, admin, resource routes,
 * redirects). Existing values set by a route win, so stricter per-route
 * policies are kept. Returns a new Response: the original may have immutable
 * headers.
 */
export function applySecurityHeaders(
  res: Response,
  opts: { nonce: string; mock: boolean },
): Response {
  const headers = new Headers(res.headers);
  const defaults: Record<string, string> = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": buildCsp(opts.nonce, opts.mock),
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
