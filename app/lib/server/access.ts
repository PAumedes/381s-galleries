import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { isSecure, readGallerySession, type GallerySession } from "./auth";
import { hashIp } from "./crypto";
import { isExpired } from "./time";

export { isSecure };

export type AccessEnv = Pick<Env, "DB" | "SESSION_SECRET"> &
  Partial<Pick<Env, "DRIVE_MODE">>;
export type GalleryRow = typeof schema.galleries.$inferSelect;
export type VisitorRow = typeof schema.visitors.$inferSelect;

/** Visitors created for "favourite without email" use this synthetic domain. */
export const ANON_DOMAIN = "@anon.invalid";
export const isAnon = (email: string) => email.endsWith(ANON_DOMAIN);

export async function findGallery(env: AccessEnv, slug: string) {
  const [g] = await getDb(env as Env)
    .select()
    .from(schema.galleries)
    .where(sql`${schema.galleries.slug} = ${slug} COLLATE NOCASE`);
  return g;
}

/** Draft, archived, expired and unknown all look the same. */
export function isAvailable(g: GalleryRow | undefined): g is GalleryRow {
  return !!g && g.status === "published" && !isExpired(g.expiresAt);
}

export function crossSite(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = request.headers.get("Origin");
  if (origin !== null) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Hashed client IP. Single policy for a missing `CF-Connecting-IP`: "local" in
 * mock mode (dev), otherwise null (callers decide: 429 or no dedupe bucket).
 */
export async function clientIpHash(
  request: Request,
  env: AccessEnv,
): Promise<string | null> {
  const ip =
    request.headers.get("CF-Connecting-IP") ??
    (env.DRIVE_MODE === "mock" ? "local" : null);
  return ip ? hashIp(ip, env.SESSION_SECRET) : null;
}

/**
 * The gate every client route shares: the gallery is available and, when it
 * has a PIN, this request holds a matching unlocked session. Otherwise null.
 */
export async function openGallery(
  request: Request,
  gallery: GalleryRow | undefined,
  env: AccessEnv,
): Promise<{ g: GalleryRow; session: GallerySession | null } | null> {
  if (!isAvailable(gallery)) return null;
  const session = await readGallerySession(
    request,
    { id: gallery.id, pinHash: gallery.pinHash },
    env,
  );
  if (gallery.pinHash && !session?.unlocked) return null;
  return { g: gallery, session };
}

/**
 * Visitor gate (favourites now, downloads in Phase 3): when the gallery
 * requires an email, a missing or anonymous visitor gets `email_required`.
 */
export async function requireVisitor(
  env: AccessEnv,
  g: GalleryRow,
  session: GallerySession | null,
): Promise<{ visitor: VisitorRow | null; error?: "email_required" }> {
  let visitor: VisitorRow | null = null;
  if (session?.visitorId) {
    const [v] = await getDb(env as Env)
      .select()
      .from(schema.visitors)
      .where(
        and(
          eq(schema.visitors.id, session.visitorId),
          eq(schema.visitors.galleryId, g.id),
        ),
      );
    visitor = v ?? null;
  }
  if (g.requireEmail && (!visitor || isAnon(visitor.email))) {
    return { visitor, error: "email_required" };
  }
  return { visitor };
}
