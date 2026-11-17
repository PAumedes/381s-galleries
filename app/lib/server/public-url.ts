/**
 * Canonical public origin for links shown to the photographer (share panel,
 * QR, print card). Never derived from the Host header when `PUBLIC_ORIGIN` is
 * valid: https only (http allowed for localhost), no credentials/path.
 */
export function validPublicOrigin(env: {
  PUBLIC_ORIGIN?: string;
}): string | null {
  const raw = env.PUBLIC_ORIGIN?.trim();
  if (!raw) return null;
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
    // invalid
  }
  return null;
}

export function publicOrigin(
  env: { PUBLIC_ORIGIN?: string },
  request: Request,
): string {
  return validPublicOrigin(env) ?? new URL(request.url).origin;
}

export function publicGalleryUrl(
  env: { PUBLIC_ORIGIN?: string },
  request: Request,
  slug: string,
): string {
  return `${publicOrigin(env, request)}/${slug}`;
}
