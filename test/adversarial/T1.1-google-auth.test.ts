import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  disconnectGoogle,
  exchangeCode,
  getAccessToken,
  handleCallback,
  handleConnect,
  isGoogleConnected,
} from "../../app/lib/server/google-auth";

const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const e = {
  ...env,
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "csecret",
  DRIVE_MODE: "mock",
  ALLOW_DEV_ADMIN: "1",
} as Env;
const R = "http://localhost/admin/google/callback";
const j = (b: object, status = 200) => new Response(JSON.stringify(b), { status });
const good = { access_token: "A", refresh_token: "RT", expires_in: 3600, scope: SCOPE };

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});
beforeEach(async () => {
  await disconnectGoogle(e);
});

describe("T1.1 adversarial", () => {
  it("misconfigured TOKEN_KEY must not permanently delete the stored refresh token", async () => {
    await exchangeCode(e, "c", R, async () => j(good));
    const bad = { ...e, TOKEN_KEY: "not-a-valid-key" } as Env;
    await getAccessToken(bad, { forceRefresh: true, fetchImpl: async () => j({}) }).catch(() => {});
    // Config typo (not a rotation) destroyed the credential; restoring the key should recover.
    expect(await isGoogleConnected(e)).toBe(true);
  });

  it("stale invalid_grant for an old refresh token must not wipe a newer reconnect", async () => {
    await exchangeCode(e, "c", R, async () => j(good));
    const p = getAccessToken(e, {
      forceRefresh: true,
      fetchImpl: async () => {
        // admin reconnects while the old-token refresh is in flight
        await exchangeCode(e, "c2", R, async () => j({ ...good, refresh_token: "RT2" }));
        return j({ error: "invalid_grant" }, 400);
      },
    });
    await p.catch(() => {});
    expect(await isGoogleConnected(e)).toBe(true);
  });

  it("refresh response with empty access_token is rejected, not cached", async () => {
    await exchangeCode(e, "c", R, async () => j(good));
    const tok = await getAccessToken(e, {
      forceRefresh: true,
      fetchImpl: async () => j({ access_token: "", expires_in: 3600 }),
    }).catch(() => "REJECTED");
    expect(tok).toBe("REJECTED");
  });

  it("exchange rejects a grant that includes extra (write) scopes", async () => {
    await expect(
      exchangeCode(e, "c", R, async () =>
        j({ ...good, scope: `${SCOPE} https://www.googleapis.com/auth/drive` }),
      ),
    ).rejects.toThrow();
  });

  it("state is single-use: replaying the same cookie+state after success is rejected", async () => {
    const res = await handleConnect(new Request("http://localhost/admin/google/connect"), e);
    const cookie = res.headers.get("Set-Cookie")!.split(";")[0];
    const state = new URL(res.headers.get("Location")!).searchParams.get("state")!;
    const mk = () =>
      new Request(`http://localhost/admin/google/callback?code=x&state=${state}`, {
        headers: { Cookie: cookie },
      });
    const ok = () => async () => j(good);
    const first = await handleCallback(mk(), e, ok());
    expect(first.headers.get("Location")).toContain("connected");
    const second = await handleCallback(mk(), e, ok());
    expect(second.status).toBe(400);
  });
});
