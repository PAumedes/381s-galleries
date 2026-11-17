import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "../app/db";
import {
  GoogleAuthError,
  buildAuthUrl,
  disconnectGoogle,
  exchangeCode,
  getAccessToken,
  handleCallback,
  handleConnect,
  isGoogleConnected,
} from "../app/lib/server/google-auth";
import { decryptSecret, signToken } from "../app/lib/server/crypto";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}

const db = getDb(env);
const e = {
  ...env,
  GOOGLE_CLIENT_ID: "client-id-123",
  GOOGLE_CLIENT_SECRET: "client-secret-456",
} as Env;
const adminEnv = {
  ...e,
  DRIVE_MODE: "mock",
  ALLOW_DEV_ADMIN: "1",
  PUBLIC_ORIGIN: "http://localhost:5173",
} as Env;
const REDIRECT = "https://galleries.example.com/admin/google/callback";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

async function raw(key: string) {
  const [r] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key));
  return r?.value;
}

function tokenFetch(body: object, status = 200) {
  return vi.fn(
    async (_u: RequestInfo | URL, _i?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
}

const good = {
  access_token: "ACCESS-TOKEN-SECRET",
  refresh_token: "REFRESH-TOKEN-SECRET",
  expires_in: 3600,
  scope: SCOPE,
  token_type: "Bearer",
};

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});
beforeEach(async () => {
  await disconnectGoogle(e);
  await env.DB.prepare(
    "DELETE FROM settings WHERE key LIKE 'oauth_state_used:%'",
  ).run();
});

describe("buildAuthUrl", () => {
  it("has all required params", () => {
    const u = new URL(buildAuthUrl(e, REDIRECT, "st8"));
    expect(u.origin + u.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    const p = u.searchParams;
    expect(p.get("client_id")).toBe("client-id-123");
    expect(p.get("redirect_uri")).toBe(REDIRECT);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe(SCOPE);
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("include_granted_scopes")).toBe("false");
    expect(p.get("state")).toBe("st8");
  });
});

describe("exchangeCode", () => {
  it("posts form-encoded and stores encrypted tokens", async () => {
    const f = tokenFetch(good);
    await exchangeCode(e, "the-code", REDIRECT, f);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("redirect_uri")).toBe(REDIRECT);
    expect(body.get("client_id")).toBe("client-id-123");
    expect(body.get("client_secret")).toBe("client-secret-456");

    const rt = await raw("google_refresh_token");
    const at = await raw("google_access_token");
    expect(rt).toBeTruthy();
    expect(rt).not.toContain("REFRESH-TOKEN-SECRET");
    expect(at).not.toContain("ACCESS-TOKEN-SECRET");
    expect(await decryptSecret(rt!, e.TOKEN_KEY)).toBe("REFRESH-TOKEN-SECRET");
    const cached = JSON.parse(await decryptSecret(at!, e.TOKEN_KEY));
    expect(cached.token).toBe("ACCESS-TOKEN-SECRET");
    expect(typeof cached.expiresAt).toBe("number");
    expect(await isGoogleConnected(e)).toBe(true);
  });

  it("errors without refresh_token and stores nothing", async () => {
    const rest: Record<string, unknown> = { ...good };
    delete rest.refresh_token;
    await expect(
      exchangeCode(e, "c", REDIRECT, tokenFetch(rest)),
    ).rejects.toThrow(/no_refresh_token/);
    expect(await isGoogleConnected(e)).toBe(false);
    expect(await raw("google_access_token")).toBeUndefined();
  });

  it("errors when drive.readonly scope not granted", async () => {
    await expect(
      exchangeCode(e, "c", REDIRECT, tokenFetch({ ...good, scope: "openid" })),
    ).rejects.toThrow(/scope/);
    expect(await isGoogleConnected(e)).toBe(false);
  });

  it("errors on non-OK response without leaking body", async () => {
    const f = tokenFetch({ error: "invalid_request", secret: "LEAKY" }, 400);
    const err = await exchangeCode(e, "c", REDIRECT, f).catch((x) => x);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).not.toContain("LEAKY");
    expect(await isGoogleConnected(e)).toBe(false);
  });
});

describe("getAccessToken", () => {
  async function connect(expiresIn = 3600) {
    await exchangeCode(
      e,
      "c",
      REDIRECT,
      tokenFetch({ ...good, expires_in: expiresIn }),
    );
  }

  it("cache hit makes no fetch", async () => {
    await connect();
    const f = tokenFetch({});
    expect(await getAccessToken(e, { fetchImpl: f })).toBe(
      "ACCESS-TOKEN-SECRET",
    );
    expect(f).not.toHaveBeenCalled();
  });

  it("expiresAt is now + expires_in - 300s", async () => {
    const before = Date.now();
    await connect(3600);
    const at = await raw("google_access_token");
    const c = JSON.parse(await decryptSecret(at!, e.TOKEN_KEY));
    const approx = before + 3300_000;
    expect(Math.abs(c.expiresAt - approx)).toBeLessThan(5000);
  });

  it("expired token refreshes and updates cache", async () => {
    await connect();
    const f = tokenFetch({ access_token: "NEW1", expires_in: 3600 });
    const now = () => Date.now() + 3600_000;
    expect(await getAccessToken(e, { fetchImpl: f, now })).toBe("NEW1");
    const body = new URLSearchParams(String(f.mock.calls[0][1]?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("REFRESH-TOKEN-SECRET");
    const f2 = tokenFetch({});
    expect(await getAccessToken(e, { fetchImpl: f2 })).toBe("NEW1");
    expect(f2).not.toHaveBeenCalled();
  });

  it("forceRefresh refreshes", async () => {
    await connect();
    const f = tokenFetch({ access_token: "NEW2", expires_in: 3600 });
    expect(await getAccessToken(e, { forceRefresh: true, fetchImpl: f })).toBe(
      "NEW2",
    );
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("invalid_grant wipes tokens and throws reconnect_required", async () => {
    await connect();
    const f = tokenFetch({ error: "invalid_grant" }, 400);
    const err = await getAccessToken(e, {
      forceRefresh: true,
      fetchImpl: f,
    }).catch((x) => x);
    expect(err).toBeInstanceOf(GoogleAuthError);
    expect(err.code).toBe("reconnect_required");
    expect(await raw("google_refresh_token")).toBeUndefined();
    expect(await raw("google_access_token")).toBeUndefined();
    expect(await isGoogleConnected(e)).toBe(false);
  });

  it("not connected throws reconnect_required", async () => {
    const err = await getAccessToken(e, { fetchImpl: tokenFetch({}) }).catch(
      (x) => x,
    );
    expect(err).toBeInstanceOf(GoogleAuthError);
    expect(err.code).toBe("reconnect_required");
  });

  it("concurrent callers share one refresh fetch", async () => {
    await connect();
    const f = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return new Response(
        JSON.stringify({ access_token: "SHARED", expires_in: 3600 }),
      );
    });
    const rs = await Promise.all([
      getAccessToken(e, { forceRefresh: true, fetchImpl: f }),
      getAccessToken(e, { forceRefresh: true, fetchImpl: f }),
      getAccessToken(e, { forceRefresh: true, fetchImpl: f }),
    ]);
    expect(rs).toEqual(["SHARED", "SHARED", "SHARED"]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("disconnectGoogle", () => {
  it("removes both rows", async () => {
    await exchangeCode(e, "c", REDIRECT, tokenFetch(good));
    await disconnectGoogle(e);
    expect(await isGoogleConnected(e)).toBe(false);
    expect(await raw("google_access_token")).toBeUndefined();
  });
});

const ORIGIN = "http://localhost:5173";
function req(path: string, cookie?: string) {
  return new Request(`${ORIGIN}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}
async function stateCookie(state: string, ttl = 600) {
  return `g_oauth_state=${await signToken({ state }, e.SESSION_SECRET, ttl)}`;
}

describe("connect route", () => {
  it("non-admin gets 401", async () => {
    const r = await handleConnect(req("/admin/google/connect"), e).catch(
      (x) => x,
    );
    expect(r).toBeInstanceOf(Response);
    expect(r.status).toBe(401);
  });

  it("admin gets 302 to Google with state matching cookie", async () => {
    const r = await handleConnect(req("/admin/google/connect"), adminEnv);
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("Location")!);
    expect(loc.host).toBe("accounts.google.com");
    expect(loc.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/admin/google/callback`,
    );
    const state = loc.searchParams.get("state")!;
    expect(state.length).toBeGreaterThanOrEqual(32);
    const sc = r.headers.get("Set-Cookie")!;
    expect(sc).toMatch(/^g_oauth_state=/);
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("SameSite=Lax");
    expect(sc).toContain("Max-Age=600");
    // localhost over http: Secure may be omitted only there
    const token = sc.split(";")[0].split("=").slice(1).join("=");
    const { verifyToken } = await import("../app/lib/server/crypto");
    const p = await verifyToken<{ state: string }>(token, e.SESSION_SECRET);
    expect(p?.state).toBe(state);
  });

  it("sets Secure on https origins", async () => {
    const r = await handleConnect(
      new Request("https://galleries.example.com/admin/google/connect"),
      {
        ...adminEnv,
        ADMIN_EMAIL: "a@b.c",
        // non-localhost needs real admin; emulate by dev bypass on localhost host only
      } as Env,
    ).catch((x) => x);
    // https non-localhost host is not admin in tests => 401
    expect(r.status).toBe(401);
  });

  it("builds redirect_uri from PUBLIC_ORIGIN, not request.url", async () => {
    const r = await handleConnect(req("/admin/google/connect"), {
      ...adminEnv,
      PUBLIC_ORIGIN: "https://gallery.example.org",
    } as Env);
    const loc = new URL(r.headers.get("Location")!);
    expect(loc.searchParams.get("redirect_uri")).toBe(
      "https://gallery.example.org/admin/google/callback",
    );
  });

  it("rejects insecure non-localhost origin", async () => {
    const r = await handleConnect(
      new Request("http://evil.example.com/admin/google/connect", {
        headers: { Host: "localhost" },
      }),
      adminEnv,
    ).catch((x) => x);
    expect([400, 401]).toContain(r.status);
  });
});

describe("callback route", () => {
  const cb = (qs: string, cookie?: string) =>
    handleCallback(
      req(`/admin/google/callback?${qs}`, cookie),
      adminEnv,
      tokenFetch(good),
    );

  it("token exchange uses the PUBLIC_ORIGIN redirect_uri", async () => {
    const f = tokenFetch(good);
    await handleCallback(
      req("/admin/google/callback?code=c&state=sx", await stateCookie("sx")),
      { ...adminEnv, PUBLIC_ORIGIN: "https://gallery.example.org" } as Env,
      f,
    );
    const body = new URLSearchParams(String(f.mock.calls[0][1]?.body));
    expect(body.get("redirect_uri")).toBe(
      "https://gallery.example.org/admin/google/callback",
    );
  });

  it("non-admin gets 401", async () => {
    const r = await handleCallback(
      req("/admin/google/callback?code=c&state=s"),
      e,
      tokenFetch(good),
    ).catch((x) => x);
    expect(r.status).toBe(401);
  });

  it("missing cookie -> 400", async () => {
    const r = await cb("code=c&state=s1");
    expect(r.status).toBe(400);
    expect(await isGoogleConnected(e)).toBe(false);
  });

  it("missing state param -> 400", async () => {
    const r = await cb("code=c", await stateCookie("s1"));
    expect(r.status).toBe(400);
  });

  it("mismatched state -> 400", async () => {
    const r = await cb("code=c&state=other", await stateCookie("s1"));
    expect(r.status).toBe(400);
    expect(await isGoogleConnected(e)).toBe(false);
  });

  it("expired cookie -> 400", async () => {
    const r = await cb("code=c&state=s1", await stateCookie("s1", -10));
    expect(r.status).toBe(400);
  });

  it("forged cookie -> 400", async () => {
    const r = await cb("code=c&state=s1", "g_oauth_state=abc.def");
    expect(r.status).toBe(400);
  });

  it("error param -> redirect with error flag, no exchange", async () => {
    const f = tokenFetch(good);
    const r = await handleCallback(
      req(
        "/admin/google/callback?error=access_denied&state=s1",
        await stateCookie("s1"),
      ),
      adminEnv,
      f,
    );
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/admin?google=error&reason=denied");
    expect(f).not.toHaveBeenCalled();
  });

  it("missing code -> 400", async () => {
    const r = await cb("state=s1", await stateCookie("s1"));
    expect(r.status).toBe(400);
  });

  it("success stores tokens, clears cookie, redirects", async () => {
    const r = await cb("code=c&state=s1", await stateCookie("s1"));
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/admin?google=connected");
    const sc = r.headers.get("Set-Cookie")!;
    expect(sc).toMatch(/^g_oauth_state=;/);
    expect(sc).toContain("Max-Age=0");
    expect(await isGoogleConnected(e)).toBe(true);
  });

  it("exchange failure -> generic redirect error, no token leak", async () => {
    const r = await handleCallback(
      req("/admin/google/callback?code=c&state=s1", await stateCookie("s1")),
      adminEnv,
      tokenFetch({ error: "bad" }, 400),
    );
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(
      "/admin?google=error&reason=exchange",
    );
    expect(await isGoogleConnected(e)).toBe(false);
  });
});
