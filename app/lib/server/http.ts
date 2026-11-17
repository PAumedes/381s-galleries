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
