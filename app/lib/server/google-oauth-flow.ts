import { requireAdmin } from "./auth";
import { publicOrigin } from "./public-url";
import { b64urlEncode, signToken, verifyToken } from "./crypto";
import { SETTINGS_KEYS } from "./settings";
import {
  exchangeCode,
  GoogleExchangeError,
  SCOPE,
  type CallbackReason,
  type FetchImpl,
  type GoogleEnv,
} from "./google-token";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const STATE_COOKIE = "g_oauth_state";
const STATE_TTL_SECONDS = 600;
const CALLBACK_PATH = "/admin/google/callback";

export function buildAuthUrl(
  env: Pick<Env, "GOOGLE_CLIENT_ID">,
  redirectUri: string,
  state: string,
): string {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  }).toString();
  return u.toString();
}

type FlowEnv = GoogleEnv &
  Pick<Env, "PUBLIC_ORIGIN"> &
  Parameters<typeof requireAdmin>[1] &
  Pick<Env, "SESSION_SECRET">;

function redirectUriFor(
  env: { PUBLIC_ORIGIN?: string },
  request: Request,
): string | null {
  const u = new URL(publicOrigin(env, request));
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) {
    return null;
  }
  return `${u.origin}${CALLBACK_PATH}`;
}

function cookieHeader(value: string, maxAge: number, secure: boolean) {
  return [
    `${STATE_COOKIE}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/admin/google",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function readStateCookies(request: Request): string[] {
  const out: string[] = [];
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i !== -1 && part.slice(0, i).trim() === STATE_COOKIE) {
      out.push(part.slice(i + 1).trim());
    }
  }
  return out;
}

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

const bad = () => new Response("Bad request", { status: 400 });

/** Throws a 401 Response for non-admins. */
export async function handleConnect(
  request: Request,
  env: FlowEnv,
): Promise<Response> {
  await requireAdmin(request, env);
  const redirectUri = redirectUriFor(env, request);
  if (!redirectUri) return bad();
  const state = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const token = await signToken(
    { state },
    env.SESSION_SECRET,
    STATE_TTL_SECONDS,
  );
  const secure = new URL(request.url).protocol === "https:";
  return new Response(null, {
    status: 302,
    headers: {
      Location: buildAuthUrl(env, redirectUri, state),
      "Set-Cookie": cookieHeader(token, STATE_TTL_SECONDS, secure),
      "Cache-Control": "no-store",
    },
  });
}

export async function handleCallback(
  request: Request,
  env: FlowEnv,
  fetchImpl?: FetchImpl,
): Promise<Response> {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const redirectUri = redirectUriFor(env, request);
  if (!redirectUri) return bad();
  const param = url.searchParams.get("state");
  let nonceExp: number | null = null;
  if (param) {
    for (const raw of readStateCookies(request)) {
      const p = await verifyToken<{ state?: unknown; exp?: unknown }>(
        raw,
        env.SESSION_SECRET,
      );
      if (p && typeof p.state === "string" && safeEqual(p.state, param)) {
        nonceExp = typeof p.exp === "number" ? p.exp : null;
        break;
      }
    }
  }
  if (nonceExp === null) return bad();
  if (!(await consumeState(env, param as string, nonceExp))) return bad();
  const secure = url.protocol === "https:";
  const done = (location: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: location,
        "Set-Cookie": cookieHeader("", 0, secure),
        "Cache-Control": "no-store",
      },
    });
  const fail = (reason: CallbackReason) => {
    console.error(`google oauth callback failed: ${reason}`);
    return done(`/admin?google=error&reason=${reason}`);
  };
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error")) return fail("denied");
  if (!code) return bad();
  try {
    await exchangeCode(env, code, redirectUri, fetchImpl);
  } catch (err) {
    return fail(err instanceof GoogleExchangeError ? err.reason : "exchange");
  }
  return done("/admin?google=connected");
}

/** Marks the state nonce used; false if it was already consumed. */
async function consumeState(
  env: GoogleEnv,
  nonce: string,
  expSec: number,
): Promise<boolean> {
  const nowSec = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "DELETE FROM settings WHERE key LIKE ?1 AND CAST(value AS INTEGER) < ?2",
  )
    .bind(`${SETTINGS_KEYS.oauthStateUsedPrefix}%`, nowSec)
    .run();
  const r = await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO NOTHING",
  )
    .bind(`${SETTINGS_KEYS.oauthStateUsedPrefix}${nonce}`, String(expSec))
    .run();
  return r.meta.changes > 0;
}
