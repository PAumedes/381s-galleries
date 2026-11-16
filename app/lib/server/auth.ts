import { b64urlDecode, signToken, verifyToken } from "./crypto";

export interface GallerySession {
  galleryId: string;
  unlocked: boolean;
  visitorId?: string;
}

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

type SessionEnv = Pick<Env, "SESSION_SECRET">;
type AdminEnv = Pick<Env, "ADMIN_EMAIL" | "DRIVE_MODE"> &
  Partial<Pick<Env, "ALLOW_DEV_ADMIN" | "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD">>;

/** One cookie per gallery so unlocking one gallery never unlocks another. */
export function sessionCookieName(galleryId: string): string {
  return `g_${galleryId.replace(/[^A-Za-z0-9]/g, "")}`;
}

/** All values for cookies with this name (a stale duplicate must not shadow a valid one). */
function getCookies(request: Request, name: string): string[] {
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

export async function readGallerySession(
  request: Request,
  galleryId: string,
  env: SessionEnv,
): Promise<GallerySession | null> {
  for (const raw of getCookies(request, sessionCookieName(galleryId))) {
    const s = await verifyToken<GallerySession>(raw, env.SESSION_SECRET);
    if (!s || s.galleryId !== galleryId || typeof s.unlocked !== "boolean") {
      continue;
    }
    return {
      galleryId: s.galleryId,
      unlocked: s.unlocked,
      ...(s.visitorId ? { visitorId: s.visitorId } : {}),
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
 * ADMIN_EMAIL (case-insensitive). The header must match too.
 *
 * LOCAL DEV EXCEPTION: nothing is required only when ALL hold:
 * DRIVE_MODE is "mock", ALLOW_DEV_ADMIN is "1" (set only in .dev.vars, never
 * in wrangler.jsonc), and the request host is localhost or 127.0.0.1.
 *
 * Throws a 401 Response when access is denied.
 */
export async function requireAdmin(
  request: Request,
  env: AdminEnv,
): Promise<void> {
  const admin = env.ADMIN_EMAIL?.trim().toLowerCase();
  const header = request.headers
    .get("Cf-Access-Authenticated-User-Email")
    ?.trim()
    .toLowerCase();
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (admin && header === admin && jwt) {
    const email = await verifyAccessJwt(jwt, env);
    if (email === admin) return;
  }
  const host = new URL(request.url).hostname;
  if (
    env.DRIVE_MODE === "mock" &&
    env.ALLOW_DEV_ADMIN === "1" &&
    (host === "localhost" || host === "127.0.0.1")
  ) {
    return;
  }
  throw new Response("Unauthorized", { status: 401 });
}
