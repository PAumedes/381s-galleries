/**
 * JSON reply for the client API: `no-store`, optional session cookie and
 * extra headers (e.g. `Retry-After`).
 */
export function jsonReply(
  body: unknown,
  status = 200,
  cookie?: string,
  extra: Record<string, string> = {},
): Response {
  const h = new Headers({ "Cache-Control": "no-store", ...extra });
  h.set("Content-Type", "application/json");
  if (cookie) h.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers: h });
}

/** Header names/values repeated across responses (one definition). */
export const NOSNIFF = { "X-Content-Type-Options": "nosniff" } as const;
export const NO_STORE = "no-store";
export const PRIVATE_NO_STORE = "private, no-store";
export const TEXT_UTF8 = "text/plain; charset=utf-8";

/** Plain-text reply (404/410/429/502 bodies); `headers` may override Content-Type. */
export function textResponse(
  body: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": TEXT_UTF8, ...headers },
  });
}

/** 405 with `Allow`; empty body unless `body` is given. */
export function methodNotAllowed(
  allow: string,
  body: string | null = null,
  extra: Record<string, string> = {},
): Response {
  return new Response(body, {
    status: 405,
    headers: { Allow: allow, ...extra },
  });
}
