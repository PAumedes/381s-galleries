/**
 * Memory of "this visitor came from the client's page" (T6.54). The Referer
 * proves it once; steps that lose the Referer (a PIN form posted without JS
 * and its redirect, a reload, the language switch) would drop the back link.
 * So when the Referer grants the link, one short-lived signed cookie per
 * CLIENT (`b_<clientId>`) records it, with the page number to return to. It is
 * only ever set by a valid Referer, never read for another client, and every
 * rule of the link (page enabled, album listed) is re-checked on each use.
 */
import { getCookies } from "./auth";
import { signToken, verifyToken } from "./crypto";

type SessionEnv = Pick<Env, "SESSION_SECRET">;

/** How long a visit to the client page vouches for its back link. */
export const BACK_TTL_SECONDS = 60 * 60;

interface BackToken {
  /** Domain separation from the other signed cookies (same secret). */
  k: "back";
  clientId: string;
  page: number;
}

export const backCookieName = (clientId: string): string =>
  `b_${clientId.replace(/[^A-Za-z0-9]/g, "")}`;

/** Set-Cookie value remembering the client page (and its page number). */
export async function backCookie(
  clientId: string,
  page: number,
  env: SessionEnv,
  { secure }: { secure: boolean },
): Promise<string> {
  const payload: BackToken = { k: "back", clientId, page };
  const token = await signToken(payload, env.SESSION_SECRET, BACK_TTL_SECONDS);
  return [
    `${backCookieName(clientId)}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${BACK_TTL_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** The remembered page number for this client, or null (no, forged, other client, expired). */
export async function readBackPage(
  request: Request,
  clientId: string,
  env: SessionEnv,
): Promise<number | null> {
  for (const raw of getCookies(request, backCookieName(clientId))) {
    const s = await verifyToken<BackToken>(raw, env.SESSION_SECRET);
    if (
      s &&
      s.k === "back" &&
      s.clientId === clientId &&
      Number.isInteger(s.page) &&
      s.page >= 1
    )
      return s.page;
  }
  return null;
}
