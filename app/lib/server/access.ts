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
 * First 64 bits of an IPv6 address as `xxxx:xxxx:xxxx:xxxx::/64` (one subscriber
 * owns a whole /64, so per-address limits are meaningless). IPv4 and anything
 * unparseable are returned unchanged.
 */
export function ipv6Prefix64(ip: string): string {
  if (!ip.includes(":")) return ip;
  let addr = ip.split("%")[0].toLowerCase();
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(addr);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return ip;
    const hex = (x: number, y: number) => ((x << 8) | y).toString(16);
    addr = addr.slice(0, v4.index) + `${hex(a, b)}:${hex(c, d)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return ip;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return ip;
    groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  } else groups = head;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g)))
    return ip;
  return (
    groups
      .slice(0, 4)
      .map((g) => g.padStart(4, "0"))
      .join(":") + "::/64"
  );
}

/**
 * Hashed client IP. Single policy for a missing `CF-Connecting-IP`: "local" in
 * mock mode (dev), otherwise null (callers decide: 429 or no dedupe bucket).
 * `prefix64` collapses IPv6 addresses to their /64 (abuse limiters).
 */
export async function clientIpHash(
  request: Request,
  env: AccessEnv,
  opts: { prefix64?: boolean } = {},
): Promise<string | null> {
  const ip =
    request.headers.get("CF-Connecting-IP") ??
    (env.DRIVE_MODE === "mock" ? "local" : null);
  if (!ip) return null;
  return hashIp(
    opts.prefix64 ? ipv6Prefix64(ip.trim()) : ip,
    env.SESSION_SECRET,
  );
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
