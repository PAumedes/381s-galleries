/**
 * Client PIN unlock (T6.52). One signed cookie per CLIENT (`c_<clientId>`),
 * distinct from the per-album session (`g_<galleryId>`): it records "this
 * visitor entered the client PIN" and nothing else. It is bound to the client
 * id AND to a fingerprint of the client's CURRENT pin hash, so changing or
 * removing the PIN kills every cookie, and a cookie of one client is worthless
 * for another (an album moved to a different client is judged by the NEW
 * client's cookie, read from the database on every request).
 */
import {
  getCookies,
  pinFingerprint,
  safeEqual,
  SESSION_TTL_SECONDS,
} from "./auth";
import { signToken, verifyToken } from "./crypto";

type SessionEnv = Pick<Env, "SESSION_SECRET">;

/** What the gate needs of a client: its id and current PIN hash. */
export interface PinClient {
  id: string;
  pinHash: string;
}

interface ClientUnlock {
  /** Domain separation from gallery sessions and download tokens (same secret). */
  k: "client";
  clientId: string;
  pf: string;
}

export const clientCookieName = (clientId: string): string =>
  `c_${clientId.replace(/[^A-Za-z0-9]/g, "")}`;

/** True when this request carries a valid unlock for the client's current PIN. */
export async function clientUnlocked(
  request: Request,
  client: PinClient,
  env: SessionEnv,
): Promise<boolean> {
  const pf = await pinFingerprint(client.pinHash, env);
  for (const raw of getCookies(request, clientCookieName(client.id))) {
    const s = await verifyToken<ClientUnlock>(raw, env.SESSION_SECRET);
    if (
      s &&
      s.k === "client" &&
      s.clientId === client.id &&
      typeof s.pf === "string" &&
      safeEqual(s.pf, pf)
    )
      return true;
  }
  return false;
}

/** Set-Cookie value that unlocks the client's albums for this visitor. */
export async function clientUnlockCookie(
  client: PinClient,
  env: SessionEnv,
  { secure }: { secure: boolean },
): Promise<string> {
  const payload: ClientUnlock = {
    k: "client",
    clientId: client.id,
    pf: await pinFingerprint(client.pinHash, env),
  };
  const token = await signToken(
    payload,
    env.SESSION_SECRET,
    SESSION_TTL_SECONDS,
  );
  return [
    `${clientCookieName(client.id)}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
