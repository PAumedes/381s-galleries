import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin, resetAccessKeyCache } from "../../app/lib/server/auth";
import { b64urlEncode } from "../../app/lib/server/crypto";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag-123";
const te = new TextEncoder();
const google = {
  ADMIN_EMAIL: "admin@example.com",
  DRIVE_MODE: "google",
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
} as const;

describe("T0r2 adversarial: Access JWT", () => {
  let pair: CryptoKeyPair;
  beforeEach(async () => {
    resetAccessKeyCache();
    pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const jwk = {
      ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
      kid: "k",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [jwk] })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  async function jwt(claims: Record<string, unknown>) {
    const now = Math.floor(Date.now() / 1000);
    const h = b64urlEncode(JSON.stringify({ alg: "RS256", kid: "k" }));
    const p = b64urlEncode(
      JSON.stringify({
        aud: [AUD],
        iss: `https://${TEAM}`,
        email: "admin@example.com",
        exp: now + 300,
        ...claims,
      }),
    );
    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      te.encode(`${h}.${p}`),
    );
    return `${h}.${p}.${b64urlEncode(new Uint8Array(sig))}`;
  }
  const req = (j: string) =>
    new Request("https://s.test/admin", {
      headers: {
        "Cf-Access-Authenticated-User-Email": "admin@example.com",
        "Cf-Access-Jwt-Assertion": j,
      },
    });

  it("control: valid token accepted", async () => {
    await expect(
      requireAdmin(req(await jwt({})), google),
    ).resolves.toBeUndefined();
  });

  it("a token that expired 30s ago must be rejected (exp skew extends lifetime)", async () => {
    const j = await jwt({ exp: Math.floor(Date.now() / 1000) - 30 });
    await expect(requireAdmin(req(j), google)).rejects.toBeInstanceOf(Response);
  });
});
