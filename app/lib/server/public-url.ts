/**
 * Canonical public origin for links shown to the photographer (share panel,
 * QR, print card). Never derived from the Host header when `PUBLIC_ORIGIN` is
 * valid: https only (http allowed for localhost), no credentials/path.
 */
export function publicOrigin(
  env: { PUBLIC_ORIGIN?: string },
  request: Request,
): string {
  const raw = env.PUBLIC_ORIGIN?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      const local =
        u.hostname === "localhost" ||
        u.hostname === "127.0.0.1" ||
        u.hostname === "[::1]";
      const okProto =
        u.protocol === "https:" || (local && u.protocol === "http:");
      if (okProto && !u.username && !u.password) return u.origin;
    } catch {
      // fall through to the request origin
    }
  }
  return new URL(request.url).origin;
}

export function publicGalleryUrl(
  env: { PUBLIC_ORIGIN?: string },
  request: Request,
  slug: string,
): string {
  return `${publicOrigin(env, request)}/${slug}`;
}
