import { inArray } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { decryptSecret, encryptSecret } from "./crypto";
import {
  SETTINGS_KEYS,
  deleteSetting,
  getSetting,
  putSetting,
} from "./settings";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const REFRESH_KEY = SETTINGS_KEYS.googleRefreshToken;
const ACCESS_KEY = SETTINGS_KEYS.googleAccessToken;
const EXPIRY_MARGIN_MS = 300_000;

export type GoogleEnv = Pick<
  Env,
  "DB" | "TOKEN_KEY" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"
>;
export type FetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class GoogleAuthError extends Error {
  constructor(public readonly code: "reconnect_required") {
    super(code);
    this.name = "GoogleAuthError";
  }
}

export type CallbackReason =
  "denied" | "state" | "exchange" | "no_refresh_token" | "scope";

export class GoogleExchangeError extends Error {
  constructor(
    public readonly reason: "exchange" | "no_refresh_token" | "scope",
  ) {
    super(reason);
    this.name = "GoogleExchangeError";
  }
}

async function cacheAccessToken(
  env: GoogleEnv,
  token: string,
  expiresInSec: number,
  nowMs: number,
  /** When set, write only if the stored refresh token still equals this. */
  onlyIfRefresh?: string,
) {
  const expiresAt = nowMs + expiresInSec * 1000 - EXPIRY_MARGIN_MS;
  const value = await encryptSecret(
    JSON.stringify({ token, expiresAt }),
    env.TOKEN_KEY,
  );
  if (onlyIfRefresh === undefined) {
    await putSetting(env, ACCESS_KEY, value);
    return;
  }
  await env.DB.prepare(
    "INSERT INTO settings (key, value) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM settings WHERE key = ?3 AND value = ?4) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(ACCESS_KEY, value, REFRESH_KEY, onlyIfRefresh)
    .run();
}

function validAccess(body: TokenResponse): body is TokenResponse & {
  access_token: string;
  expires_in: number;
} {
  return (
    typeof body.access_token === "string" &&
    body.access_token.length > 0 &&
    typeof body.expires_in === "number" &&
    Number.isFinite(body.expires_in) &&
    body.expires_in > 0
  );
}

function tokenRequest(env: GoogleEnv, params: Record<string, string>) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      ...params,
    }).toString(),
  } satisfies RequestInit;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

export async function exchangeCode(
  env: GoogleEnv,
  code: string,
  redirectUri: string,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  const res = await fetchImpl(
    TOKEN_URL,
    tokenRequest(env, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  );
  if (!res.ok) throw new GoogleExchangeError("exchange");
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (typeof body.refresh_token !== "string" || !body.refresh_token) {
    throw new GoogleExchangeError("no_refresh_token");
  }
  const granted = new Set(
    typeof body.scope === "string"
      ? body.scope.split(/\s+/).filter(Boolean)
      : [],
  );
  if (granted.size !== 1 || !granted.has(SCOPE)) {
    throw new GoogleExchangeError("scope");
  }
  if (!validAccess(body)) throw new GoogleExchangeError("exchange");
  await putSetting(
    env,
    REFRESH_KEY,
    await encryptSecret(body.refresh_token, env.TOKEN_KEY),
  );
  await cacheAccessToken(env, body.access_token, body.expires_in, Date.now());
}

let inflight: Promise<string> | null = null;

async function refresh(
  env: GoogleEnv,
  fetchImpl: FetchImpl,
  now: () => number,
): Promise<string> {
  const enc = await getSetting(env, REFRESH_KEY);
  if (!enc) throw new GoogleAuthError("reconnect_required");
  let refreshToken: string;
  try {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(enc)) {
      throw new Error("malformed ciphertext");
    }
    refreshToken = await decryptSecret(enc, env.TOKEN_KEY);
  } catch (err) {
    // Only a malformed value or an AES-GCM auth failure means "rotated key";
    // key-format/config errors propagate and leave the row untouched.
    const rotated =
      (err instanceof Error && err.message === "malformed ciphertext") ||
      (err instanceof Error && err.name === "OperationError");
    if (!rotated) throw err;
    await disconnectIfStored(env, enc);
    throw new GoogleAuthError("reconnect_required");
  }
  const res = await fetchImpl(
    TOKEN_URL,
    tokenRequest(env, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
  const body = (await res.json().catch(() => ({}))) as TokenResponse & {
    error?: unknown;
  };
  if (body.error === "invalid_grant") {
    await disconnectIfStored(env, enc);
    throw new GoogleAuthError("reconnect_required");
  }
  if (!res.ok || !validAccess(body)) {
    throw new Error("google token refresh failed");
  }
  await cacheAccessToken(env, body.access_token, body.expires_in, now(), enc);
  return body.access_token;
}

/** Compare-and-set disconnect: only if the row still holds `enc`. */
async function disconnectIfStored(env: GoogleEnv, enc: string) {
  const r = await env.DB.prepare(
    "DELETE FROM settings WHERE key = ?1 AND value = ?2",
  )
    .bind(REFRESH_KEY, enc)
    .run();
  if (r.meta.changes > 0) {
    await deleteSetting(env, ACCESS_KEY);
  }
}

export async function getAccessToken(
  env: GoogleEnv,
  opts: {
    forceRefresh?: boolean;
    fetchImpl?: FetchImpl;
    now?: () => number;
  } = {},
): Promise<string> {
  const now = opts.now ?? Date.now;
  if (!opts.forceRefresh) {
    const enc = await getSetting(env, ACCESS_KEY);
    if (enc) {
      try {
        const c = JSON.parse(await decryptSecret(enc, env.TOKEN_KEY)) as {
          token?: unknown;
          expiresAt?: unknown;
        };
        if (
          typeof c.token === "string" &&
          typeof c.expiresAt === "number" &&
          c.expiresAt > now()
        ) {
          return c.token;
        }
      } catch {
        // unreadable cache: fall through to refresh
      }
    }
  }
  inflight ??= refresh(env, opts.fetchImpl ?? fetch, now).finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function isGoogleConnected(env: GoogleEnv): Promise<boolean> {
  return (await getSetting(env, REFRESH_KEY)) !== undefined;
}

export async function disconnectGoogle(env: GoogleEnv): Promise<void> {
  await getDb(env as Env)
    .delete(schema.settings)
    .where(inArray(schema.settings.key, [REFRESH_KEY, ACCESS_KEY]));
}
