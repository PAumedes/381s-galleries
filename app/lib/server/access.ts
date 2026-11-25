import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../../db";
import {
  isSecure,
  pinFingerprint,
  readGallerySession,
  type GallerySession,
} from "./auth";
import { clientUnlocked } from "./client-unlock";
import { hashIp } from "./crypto";
import { isExpired } from "./time";

export { isSecure };

export type AccessEnv = Pick<Env, "DB" | "SESSION_SECRET"> &
  Partial<Pick<Env, "DRIVE_MODE">>;
export type GalleryRow = typeof schema.galleries.$inferSelect;
/**
 * The album as the access gate needs it: the row plus the PIN hash of the
 * client it is assigned to (T6.52; null = unassigned or the client has no PIN).
 * Every lookup that feeds `openGallery` joins it, so the gate cannot forget it.
 */
export type AccessRow = GalleryRow & {
  clientPinHash: string | null;
  /** Times the client's PIN was set/changed/removed (null/0 = never). */
  clientPinEpoch?: number | null;
};
export type VisitorRow = typeof schema.visitors.$inferSelect;

/** Visitors created for "favourite without email" use this synthetic domain. */
export const ANON_DOMAIN = "@anon.invalid";
export const isAnon = (email: string) => email.endsWith(ANON_DOMAIN);

/** Columns that turn a `galleries` row into an `AccessRow` (use with a left join on clients). */
export const accessSelect = {
  gallery: schema.galleries,
  clientPinHash: schema.clients.pinHash,
  clientPinEpoch: schema.clients.pinEpoch,
};
export const withClientPin = <
  R extends {
    gallery: GalleryRow;
    clientPinHash: string | null;
    clientPinEpoch: number | null;
  },
>(
  r: R,
): AccessRow => ({
  ...r.gallery,
  clientPinHash: r.clientPinHash,
  clientPinEpoch: r.clientPinEpoch,
});

export async function findGallery(
  env: AccessEnv,
  slug: string,
): Promise<AccessRow | undefined> {
  const [row] = await getDb(env as Env)
    .select(accessSelect)
    .from(schema.galleries)
    .leftJoin(schema.clients, eq(schema.galleries.clientId, schema.clients.id))
    .where(sql`${schema.galleries.slug} = ${slug} COLLATE NOCASE`);
  return row && withClientPin(row);
}

/**
 * Fingerprint of everything that gates this album, for download tokens: the
 * album's PIN hash, plus the client's when it has one, so changing either one
 * voids tokens already issued. The client's PIN epoch (bumped on every set /
 * change / remove) keeps links issued before a PIN dead after the PIN is
 * removed. Unchanged for albums whose client never had a PIN.
 */
export function accessFingerprint(
  g: AccessRow,
  env: AccessEnv,
): Promise<string> {
  const epoch = g.clientPinEpoch ?? 0;
  if (g.clientPinHash === null && epoch === 0)
    return pinFingerprint(g.pinHash, env);
  return pinFingerprint(
    `${g.pinHash ?? ""}|client|${g.clientPinHash ?? ""}|${epoch}`,
    env,
  );
}

/** True when the album asks for any PIN: its own or its client's. */
export const isPinned = (g: {
  pinHash: string | null;
  clientPinHash?: string | null;
}) => g.pinHash !== null || (g.clientPinHash ?? null) !== null;

/** Draft, archived, expired and unknown all look the same. */
export function isAvailable<G extends GalleryRow>(g: G | undefined): g is G {
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
 * owns a whole /64, so per-address limits are meaningless). IPv4-mapped and
 * NAT64 addresses collapse to their embedded IPv4; IPv4 and anything
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
  // IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96): key by the embedded
  // IPv4, otherwise every client behind the same gateway shares one /64.
  const n = groups.map((g) => parseInt(g, 16));
  const zeros = (from: number, to: number) =>
    n.slice(from, to).every((x) => x === 0);
  const mapped = zeros(0, 5) && n[5] === 0xffff;
  const nat64 = n[0] === 0x64 && n[1] === 0xff9b && zeros(2, 6);
  if (mapped || nat64)
    return `${n[6] >> 8}.${n[6] & 255}.${n[7] >> 8}.${n[7] & 255}`;
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
 * True when the album's client has a PIN that this request has not entered.
 * Checked first: the client PIN comes before the album's own PIN (T6.52).
 */
export async function clientGateClosed(
  request: Request,
  gallery: AccessRow,
  env: AccessEnv,
): Promise<boolean> {
  if (!gallery.clientId || !gallery.clientPinHash) return false;
  return !(await clientUnlocked(
    request,
    { id: gallery.clientId, pinHash: gallery.clientPinHash },
    env,
  ));
}

/** Which PIN the gate asks for now: the client's first, then the album's own. */
export type PinStep = "client" | "album";

/**
 * The step of a gate that is closed (T6.54): "client" until the client PIN was
 * entered; then "album", flagged `clientAccepted` when a client PIN was part
 * of the way here, so the page can say the first step went through.
 */
export async function pinStep(
  request: Request,
  gallery: AccessRow,
  env: AccessEnv,
): Promise<{ step: PinStep; clientAccepted?: true }> {
  if (await clientGateClosed(request, gallery, env)) return { step: "client" };
  return gallery.clientPinHash
    ? { step: "album", clientAccepted: true }
    : { step: "album" };
}

/**
 * The gate every client route shares: the gallery is available, the client PIN
 * (when its client has one) was entered, and, when the album has its own PIN,
 * this request holds a matching unlocked session. Otherwise null.
 */
export async function openGallery(
  request: Request,
  gallery: AccessRow | undefined,
  env: AccessEnv,
): Promise<{ g: AccessRow; session: GallerySession | null } | null> {
  if (!isAvailable(gallery)) return null;
  if (await clientGateClosed(request, gallery, env)) return null;
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
