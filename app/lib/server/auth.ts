import { signToken, verifyToken } from "./crypto";

export interface GallerySession {
  galleryId: string;
  unlocked: boolean;
  visitorId?: string;
}

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

type SessionEnv = Pick<Env, "SESSION_SECRET">;
type AdminEnv = Pick<Env, "ADMIN_EMAIL" | "DRIVE_MODE">;

/** One cookie per gallery so unlocking one gallery never unlocks another. */
export function sessionCookieName(galleryId: string): string {
  return `g_${galleryId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8)}`;
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export async function readGallerySession(
  request: Request,
  galleryId: string,
  env: SessionEnv,
): Promise<GallerySession | null> {
  const raw = getCookie(request, sessionCookieName(galleryId));
  if (!raw) return null;
  const s = await verifyToken<GallerySession>(raw, env.SESSION_SECRET);
  // The 8-char cookie name can collide; the signed galleryId is authoritative.
  if (!s || s.galleryId !== galleryId || typeof s.unlocked !== "boolean") {
    return null;
  }
  return {
    galleryId: s.galleryId,
    unlocked: s.unlocked,
    ...(s.visitorId ? { visitorId: s.visitorId } : {}),
  };
}

/** Returns a Set-Cookie header value. Pass `secure: false` only in local dev. */
export async function gallerySessionCookie(
  session: GallerySession,
  env: SessionEnv,
  { secure }: { secure: boolean },
): Promise<string> {
  const token = await signToken(
    session,
    env.SESSION_SECRET,
    SESSION_TTL_SECONDS,
  );
  return [
    `${sessionCookieName(session.galleryId)}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/**
 * Admin guard. Cloudflare Access sits in front of /admin* and /api/admin* and
 * injects `Cf-Access-Authenticated-User-Email`; we require it to equal
 * ADMIN_EMAIL (case-insensitive).
 *
 * LOCAL DEV EXCEPTION: when DRIVE_MODE is "mock" AND the request host is
 * localhost or 127.0.0.1, the header is not required, so the admin UI can be
 * developed without Access. Production uses DRIVE_MODE=google, so this bypass
 * can never apply there.
 *
 * Throws a 401 Response when access is denied.
 */
export function requireAdmin(request: Request, env: AdminEnv): void {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (
    email &&
    env.ADMIN_EMAIL &&
    email.trim().toLowerCase() === env.ADMIN_EMAIL.trim().toLowerCase()
  ) {
    return;
  }
  const host = new URL(request.url).hostname;
  if (
    (env.DRIVE_MODE as string) === "mock" &&
    (host === "localhost" || host === "127.0.0.1")
  ) {
    return;
  }
  throw new Response("Unauthorized", { status: 401 });
}
