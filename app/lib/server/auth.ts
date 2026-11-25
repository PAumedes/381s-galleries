import { b64urlDecode, b64urlEncode, signToken, verifyToken } from "./crypto";

export interface GallerySession {
  galleryId: string;
  unlocked: boolean;
  visitorId?: string;
  /** PIN fingerprint (see pinFingerprint): changing/clearing the PIN invalidates the session. */
  pf: string;
  /** Set once a gallery_views row was logged for this session. */
  viewed?: boolean;
}

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

type SessionEnv = Pick<Env, "SESSION_SECRET">;
type AdminEnv = Pick<Env, "ADMIN_EMAIL" | "DRIVE_MODE"> &
  Partial<Pick<Env, "ALLOW_DEV_ADMIN" | "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD">>;

/**
 * First 16 base64url chars of HMAC-SHA256(SESSION_SECRET, pinHash === null ? "pin:none" : "pin:h:" + pinHash).
 * Stored in the session so a PIN change or removal logs everyone out.
 */
export async function pinFingerprint(
  pinHash: string | null,
  env: SessionEnv,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(pinHash == null ? "pin:none" : `pin:h:${pinHash}`),
  );
  return b64urlEncode(new Uint8Array(mac)).slice(0, 16);
}

export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

/** One cookie per gallery so unlocking one gallery never unlocks another. */
export function sessionCookieName(galleryId: string): string {
  return `g_${galleryId.replace(/[^A-Za-z0-9]/g, "")}`;
}

/** All values for cookies with this name (a stale duplicate must not shadow a valid one). */
export function getCookies(request: Request, name: string): string[] {
  const header = request.headers.get("Cookie");
  if (!header) return [];
  const out: string[] = [];
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) out.push(part.slice(i + 1).trim());
  }
  return out;
}

/** `gallery` is the current DB row (id + pin_hash): a stale PIN fingerprint is rejected. */
export async function readGallerySession(
  request: Request,
  gallery: { id: string; pinHash: string | null },
  env: SessionEnv,
): Promise<GallerySession | null> {
  const pf = await pinFingerprint(gallery.pinHash, env);
  for (const raw of getCookies(request, sessionCookieName(gallery.id))) {
    const s = await verifyToken<GallerySession>(raw, env.SESSION_SECRET);
    if (
      !s ||
      s.galleryId !== gallery.id ||
      typeof s.unlocked !== "boolean" ||
      typeof s.pf !== "string" ||
      !safeEqual(s.pf, pf)
    ) {
      continue;
    }
    return {
      galleryId: s.galleryId,
      unlocked: s.unlocked,
      pf: s.pf,
      ...(s.visitorId ? { visitorId: s.visitorId } : {}),
      ...(s.viewed === true ? { viewed: true } : {}),
    };
  }
  return null;
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

export const isSecure = (request: Request) =>
  new URL(request.url).protocol === "https:";

/**
 * Set-Cookie value for this gallery's session: the current valid session (if
 * any) merged with `patch`, so no field (viewed, visitorId, unlocked) is lost.
 */
export async function updateSession(
  request: Request,
  gallery: { id: string; pinHash: string | null },
  patch: Partial<Pick<GallerySession, "unlocked" | "visitorId" | "viewed">>,
  env: SessionEnv,
): Promise<string> {
  const prev = await readGallerySession(request, gallery, env);
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );
  const next: GallerySession = {
    unlocked: prev?.unlocked ?? gallery.pinHash === null,
    ...(prev?.visitorId ? { visitorId: prev.visitorId } : {}),
    ...(prev?.viewed ? { viewed: true } : {}),
    ...defined,
    galleryId: gallery.id,
    pf: await pinFingerprint(gallery.pinHash, env),
  };
  return gallerySessionCookie(next, env, { secure: isSecure(request) });
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_REFETCH_MIN_MS = 60 * 1000;
// Leniency applies to nbf only; exp is strict.
const CLOCK_SKEW_SECONDS = 60;
const jwksCache = new Map<string, { at: number; keys: JsonWebKey[] }>();

/** Test hook: forget cached Access signing keys. */
export function resetAccessKeyCache(): void {
  jwksCache.clear();
}

async function getAccessKeys(
  domain: string,
  force: boolean,
): Promise<JsonWebKey[]> {
  const hit = jwksCache.get(domain);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < JWKS_TTL_MS && !(force && age >= JWKS_REFETCH_MIN_MS)) {
    return hit.keys;
  }
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("jwks fetch failed");
  const body = (await res.json()) as { keys?: JsonWebKey[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(domain, { at: Date.now(), keys });
  return keys;
}

function parseJson(b64: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(
      new TextDecoder().decode(b64urlDecode(b64)),
    ) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Verifies a Cloudflare Access JWT; returns the (lowercased) email claim or null. */
async function verifyAccessJwt(
  jwt: string,
  env: AdminEnv,
): Promise<string | null> {
  const domain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!domain || !aud) return null;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const header = parseJson(h);
  const payload = parseJson(p);
  if (!header || !payload || header.alg !== "RS256") return null;
  if (typeof header.kid !== "string") return null;
  try {
    const sig = b64urlDecode(s);
    let jwk = (await getAccessKeys(domain, false)).find(
      (k) => (k as { kid?: string }).kid === header.kid,
    );
    if (!jwk) {
      jwk = (await getAccessKeys(domain, true)).find(
        (k) => (k as { kid?: string }).kid === header.kid,
      );
    }
    if (!jwk || jwk.kty !== "RSA") return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      sig,
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) return null;
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const { exp, nbf, iss, email } = payload;
  if (typeof exp !== "number" || exp <= now) return null;
  if (
    nbf !== undefined &&
    (typeof nbf !== "number" || nbf - CLOCK_SKEW_SECONDS > now)
  ) {
    return null;
  }
  if (iss !== `https://${domain}`) return null;
  const tokenAud = payload.aud;
  const auds = Array.isArray(tokenAud) ? tokenAud : [tokenAud];
  if (!auds.includes(aud)) return null;
  return typeof email === "string" ? email.trim().toLowerCase() : null;
}

/**
 * Admin guard. Cloudflare Access sits in front of /admin* and /api/admin*.
 * The `Cf-Access-Authenticated-User-Email` header alone is never enough: the
 * `Cf-Access-Jwt-Assertion` JWT must verify (RS256 against the team JWKS, aud,
 * iss, exp/nbf) and its `email` claim, which is authoritative, must equal
 * ADMIN_EMAIL (case-insensitive). The header must match too. Without the JWT
 * header, the `CF_Authorization` cookie JWT is verified the same way.
 *
 * LOCAL DEV EXCEPTION: nothing is required only when ALL hold:
 * DRIVE_MODE is "mock", ALLOW_DEV_ADMIN is "1" (set only in .dev.vars, never
 * in wrangler.jsonc), and the request host is localhost or 127.0.0.1.
 */
async function checkAdmin(request: Request, env: AdminEnv): Promise<boolean> {
  const admin = env.ADMIN_EMAIL?.trim().toLowerCase();
  const header = request.headers
    .get("Cf-Access-Authenticated-User-Email")
    ?.trim()
    .toLowerCase();
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (jwt) {
    // Header path (preferred): the email header must match too.
    if (admin && header === admin) {
      const email = await verifyAccessJwt(jwt, env);
      if (email === admin) return true;
    }
  } else if (admin) {
    // Cookie path: single-fetch `.data` URLs (e.g. /admin.data) fall outside
    // the Access paths, so Access does not add its headers. The
    // `CF_Authorization` cookie holds the same signed JWT; it is verified
    // identically and its email claim is authoritative (no email header
    // exists on this path).
    for (const token of getCookies(request, "CF_Authorization")) {
      if (!token) continue;
      if ((await verifyAccessJwt(token, env)) === admin) return true;
    }
  }
  const host = new URL(request.url).hostname;
  if (
    env.DRIVE_MODE === "mock" &&
    env.ALLOW_DEV_ADMIN === "1" &&
    (host === "localhost" || host === "127.0.0.1")
  ) {
    return true;
  }
  return false;
}

const verdicts = new WeakMap<
  Request,
  { env: AdminEnv; ok: Promise<boolean> }
>();

/**
 * Whether the request is from the verified admin (same rules as
 * requireAdmin, never throws). The verdict is cached per Request/env so the
 * root loader and the admin route verify the Access JWT once per request.
 */
export function isAdmin(request: Request, env: AdminEnv): Promise<boolean> {
  const hit = verdicts.get(request);
  if (hit && hit.env === env) return hit.ok;
  const ok = checkAdmin(request, env);
  verdicts.set(request, { env, ok });
  return ok;
}

/** Throws a 401 Response unless the request is from the verified admin. */
export async function requireAdmin(
  request: Request,
  env: AdminEnv,
): Promise<void> {
  if (!(await isAdmin(request, env)))
    throw new Response("Unauthorized", { status: 401 });
}
