import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gallerySessionCookie,
  pinFingerprint,
  readGallerySession,
  requireAdmin,
  resetAccessKeyCache,
  sessionCookieName,
  updateSession,
} from "../app/lib/server/auth";
import { b64urlEncode } from "../app/lib/server/crypto";
import { adminIndexData } from "../app/routes/admin._index";

const G1 = "11111111-aaaa-bbbb-cccc-000000000001";
const G2 = "22222222-aaaa-bbbb-cccc-000000000002";
const g1 = { id: G1, pinHash: null };
const g2 = { id: G2, pinHash: null };
const PF_NONE = () => pinFingerprint(null, env);

function reqWithCookie(setCookie: string) {
  return new Request("https://x.test/", {
    headers: { Cookie: setCookie.split(";")[0] },
  });
}

describe("gallery session cookie", () => {
  it("roundtrips and sets attributes", async () => {
    const sc = await gallerySessionCookie(
      { galleryId: G1, unlocked: true, visitorId: "v1", pf: await PF_NONE() },
      env,
      { secure: true },
    );
    for (const a of [
      "HttpOnly",
      "SameSite=Lax",
      "Path=/",
      "Secure",
      "Max-Age=2592000",
    ]) {
      expect(sc).toContain(a);
    }
    expect(await readGallerySession(reqWithCookie(sc), g1, env)).toEqual({
      galleryId: G1,
      unlocked: true,
      visitorId: "v1",
      pf: await PF_NONE(),
    });
  });
  it("omits Secure in dev", async () => {
    const sc = await gallerySessionCookie(
      { galleryId: G1, unlocked: false, pf: await PF_NONE() },
      env,
      {
        secure: false,
      },
    );
    expect(sc).not.toContain("Secure");
  });
  it("rejects a cookie for another gallery", async () => {
    const sc = await gallerySessionCookie(
      { galleryId: G1, unlocked: true, pf: await PF_NONE() },
      env,
      {
        secure: true,
      },
    );
    expect(await readGallerySession(reqWithCookie(sc), g2, env)).toBeNull();
    // Same cookie name forced onto the other gallery: signed galleryId must still match.
    const forced = new Request("https://x.test/", {
      headers: {
        Cookie: `${sessionCookieName(G2)}=${sc.split("=")[1].split(";")[0]}`,
      },
    });
    expect(await readGallerySession(forced, g2, env)).toBeNull();
  });
  it("rejects missing or garbage cookies", async () => {
    expect(
      await readGallerySession(new Request("https://x.test/"), g1, env),
    ).toBeNull();
    const bad = new Request("https://x.test/", {
      headers: { Cookie: `${sessionCookieName(G1)}=junk` },
    });
    expect(await readGallerySession(bad, g1, env)).toBeNull();
  });
});

describe("gallery session pin fingerprint (pf)", () => {
  const cookieFor = async (pinHash: string | null, galleryId = G1) =>
    gallerySessionCookie(
      { galleryId, unlocked: true, pf: await pinFingerprint(pinHash, env) },
      env,
      { secure: true },
    );

  it("pf is 16 base64url chars and depends on the pin hash", async () => {
    const a = await pinFingerprint("hash-a", env);
    expect(a).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(await pinFingerprint("hash-b", env)).not.toBe(a);
    expect(await pinFingerprint(null, env)).not.toBe(a);
    expect(await pinFingerprint(null, env)).toBe(
      await pinFingerprint(null, env),
    );
  });
  it("pf is keyed by SESSION_SECRET", async () => {
    expect(await pinFingerprint("h", env)).not.toBe(
      await pinFingerprint("h", { SESSION_SECRET: "x".repeat(40) }),
    );
  });
  it("accepts a cookie while the pin hash is unchanged", async () => {
    const sc = await cookieFor("h1");
    expect(
      await readGallerySession(
        reqWithCookie(sc),
        { id: G1, pinHash: "h1" },
        env,
      ),
    ).not.toBeNull();
  });
  it("rejects the cookie after the PIN is changed or cleared", async () => {
    const sc = await cookieFor("h1");
    for (const pinHash of ["h2", null]) {
      expect(
        await readGallerySession(reqWithCookie(sc), { id: G1, pinHash }, env),
      ).toBeNull();
    }
  });
  it("rejects a cookie issued without a PIN once a PIN is set", async () => {
    const sc = await cookieFor(null);
    expect(
      await readGallerySession(
        reqWithCookie(sc),
        { id: G1, pinHash: "h1" },
        env,
      ),
    ).toBeNull();
  });
  it("rejects a legacy cookie with no pf claim", async () => {
    const sc = await gallerySessionCookie(
      { galleryId: G1, unlocked: true } as never,
      env,
      { secure: true },
    );
    expect(await readGallerySession(reqWithCookie(sc), g1, env)).toBeNull();
  });
});

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag-123";
const KID = "kid1";

async function genKey() {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;
}

const te = new TextEncoder();
async function makeJwt(
  priv: CryptoKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: KID },
) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: [AUD],
    iss: `https://${TEAM}`,
    email: "admin@example.com",
    exp: now + 300,
    nbf: now - 10,
    ...claims,
  };
  const h = b64urlEncode(JSON.stringify(header));
  const p = b64urlEncode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    priv,
    te.encode(`${h}.${p}`),
  );
  return `${h}.${p}.${b64urlEncode(new Uint8Array(sig))}`;
}

async function expect401(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(Response);
  expect((e as Response).status).toBe(401);
}

describe("requireAdmin", () => {
  const mk = (url: string, email?: string, jwt?: string) =>
    new Request(url, {
      headers: {
        ...(email ? { "Cf-Access-Authenticated-User-Email": email } : {}),
        ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}),
      },
    });
  const google = {
    ADMIN_EMAIL: "Admin@Example.com",
    DRIVE_MODE: "google",
    ALLOW_DEV_ADMIN: "1",
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
  } as const;
  const mock = {
    ADMIN_EMAIL: "Admin@Example.com",
    DRIVE_MODE: "mock",
    ALLOW_DEV_ADMIN: "1",
  } as const;

  let pair: CryptoKeyPair;
  let other: CryptoKeyPair;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    resetAccessKeyCache();
    pair ??= await genKey();
    other ??= await genKey();
    const jwk = {
      ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
      kid: KID,
    };
    fetchMock = vi.fn(async () => Response.json({ keys: [jwk] }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const url = "https://s.test/admin";

  it("accepts a valid JWT + matching header, case-insensitive", async () => {
    const jwt = await makeJwt(pair.privateKey, { email: "ADMIN@example.com" });
    await expect(
      requireAdmin(mk(url, "ADMIN@example.COM", jwt), google),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `https://${TEAM}/cdn-cgi/access/certs`,
    );
  });
  it("caches the JWKS between calls", async () => {
    const jwt = await makeJwt(pair.privateKey, {});
    await requireAdmin(mk(url, "admin@example.com", jwt), google);
    await requireAdmin(mk(url, "admin@example.com", jwt), google);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("401 on wrong aud", async () => {
    const jwt = await makeJwt(pair.privateKey, { aud: ["other"] });
    await expect401(requireAdmin(mk(url, "admin@example.com", jwt), google));
  });
  it("401 when expired (beyond skew)", async () => {
    const jwt = await makeJwt(pair.privateKey, {
      exp: Math.floor(Date.now() / 1000) - 120,
    });
    await expect401(requireAdmin(mk(url, "admin@example.com", jwt), google));
  });
  it("401 when not yet valid (nbf beyond skew)", async () => {
    const jwt = await makeJwt(pair.privateKey, {
      nbf: Math.floor(Date.now() / 1000) + 120,
    });
    await expect401(requireAdmin(mk(url, "admin@example.com", jwt), google));
  });
  it("401 on wrong iss", async () => {
    const jwt = await makeJwt(pair.privateKey, { iss: "https://evil.test" });
    await expect401(requireAdmin(mk(url, "admin@example.com", jwt), google));
  });
  it("401 on bad signature (signed by another key)", async () => {
    const jwt = await makeJwt(other.privateKey, {});
    await expect401(requireAdmin(mk(url, "admin@example.com", jwt), google));
  });
  it("401 on non-RS256 alg", async () => {
    const jwt = await makeJwt(pair.privateKey, {}, { alg: "none", kid: KID });
    await expect401(requireAdmin(mk(url, "admin@example.com", jwt), google));
  });
  it("401 when JWT email differs even if the header matches", async () => {
    const jwt = await makeJwt(pair.privateKey, { email: "evil@example.com" });
    await expect401(requireAdmin(mk(url, "admin@example.com", jwt), google));
  });
  it("401 when the header differs even if the JWT matches", async () => {
    const jwt = await makeJwt(pair.privateKey, {});
    await expect401(requireAdmin(mk(url, "evil@example.com", jwt), google));
  });
  it("401 with the header but no JWT", async () => {
    await expect401(requireAdmin(mk(url, "admin@example.com"), google));
  });
  it("401 when ACCESS_AUD / ACCESS_TEAM_DOMAIN are not configured", async () => {
    const jwt = await makeJwt(pair.privateKey, {});
    await expect401(
      requireAdmin(mk(url, "admin@example.com", jwt), {
        ADMIN_EMAIL: "Admin@Example.com",
        DRIVE_MODE: "google",
      }),
    );
  });
  it("401 when the JWKS fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    const jwt = await makeJwt(pair.privateKey, {});
    await expect401(requireAdmin(mk(url, "admin@example.com", jwt), google));
  });
  it("401 on missing header in google mode, even on localhost", async () => {
    for (const u of ["https://s.test/admin", "http://localhost:5173/admin"]) {
      await expect401(requireAdmin(mk(u), google));
    }
  });
  it("bypass ok only with mock + ALLOW_DEV_ADMIN=1 + localhost", async () => {
    await expect(
      requireAdmin(mk("http://localhost:5173/admin"), mock),
    ).resolves.toBeUndefined();
    await expect(
      requireAdmin(mk("http://127.0.0.1:5173/admin"), mock),
    ).resolves.toBeUndefined();
  });
  it("401 in mock mode when ALLOW_DEV_ADMIN is missing", async () => {
    await expect401(
      requireAdmin(mk("http://localhost:5173/admin"), {
        ADMIN_EMAIL: "Admin@Example.com",
        DRIVE_MODE: "mock",
      }),
    );
  });
  it("401 on a wrong email header in mock+localhost without ALLOW_DEV_ADMIN", async () => {
    await expect401(
      requireAdmin(mk("http://localhost:5173/admin", "evil@example.com"), {
        ADMIN_EMAIL: "Admin@Example.com",
        DRIVE_MODE: "mock",
      }),
    );
  });
  it("401 in mock mode on a non-localhost host", async () => {
    await expect401(
      requireAdmin(mk("https://gallery.381studios.ar/admin"), mock),
    );
  });
});

describe("requireAdmin via CF_Authorization cookie", () => {
  const google = {
    ADMIN_EMAIL: "Admin@Example.com",
    DRIVE_MODE: "google",
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
  } as const;
  const withCookie = (cookie: string, headers: Record<string, string> = {}) =>
    new Request("https://s.test/admin.data", {
      headers: { Cookie: cookie, ...headers },
    });
  let pair: CryptoKeyPair;
  let other: CryptoKeyPair;
  beforeEach(async () => {
    resetAccessKeyCache();
    pair ??= await genKey();
    other ??= await genKey();
    const jwk = {
      ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
      kid: KID,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [jwk] })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("cookie-only valid token is accepted (no email header)", async () => {
    const jwt = await makeJwt(pair.privateKey, {});
    await expect(
      requireAdmin(withCookie(`CF_Authorization=${jwt}`), google),
    ).resolves.toBeUndefined();
  });
  it("parses the cookie among other cookies", async () => {
    const jwt = await makeJwt(pair.privateKey, {});
    await expect(
      requireAdmin(withCookie(`a=1; CF_Authorization=${jwt}; g_x=2`), google),
    ).resolves.toBeUndefined();
  });
  it("401 on wrong aud / expired / bad signature / wrong email", async () => {
    const bad = [
      await makeJwt(pair.privateKey, { aud: ["other"] }),
      await makeJwt(pair.privateKey, {
        exp: Math.floor(Date.now() / 1000) - 120,
      }),
      await makeJwt(other.privateKey, {}),
      await makeJwt(pair.privateKey, { email: "evil@example.com" }),
    ];
    for (const jwt of bad) {
      await expect401(
        requireAdmin(withCookie(`CF_Authorization=${jwt}`), google),
      );
    }
  });
  it("401 on a forged non-JWT cookie or an empty one", async () => {
    await expect401(
      requireAdmin(withCookie("CF_Authorization=forged"), google),
    );
    await expect401(requireAdmin(withCookie("CF_Authorization="), google));
  });
  it("header JWT is preferred: an invalid header is not rescued by a valid cookie", async () => {
    const good = await makeJwt(pair.privateKey, {});
    const bad = await makeJwt(other.privateKey, {});
    await expect401(
      requireAdmin(
        withCookie(`CF_Authorization=${good}`, {
          "Cf-Access-Jwt-Assertion": bad,
          "Cf-Access-Authenticated-User-Email": "admin@example.com",
        }),
        google,
      ),
    );
    await expect(
      requireAdmin(
        withCookie(`CF_Authorization=${bad}`, {
          "Cf-Access-Jwt-Assertion": good,
          "Cf-Access-Authenticated-User-Email": "admin@example.com",
        }),
        google,
      ),
    ).resolves.toBeUndefined();
  });
  it("admin index loader (/admin.data) works with only the cookie", async () => {
    await applyD1Migrations(
      env.DB,
      (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
    );
    const jwt = await makeJwt(pair.privateKey, {});
    const e = { ...env, ...google } as unknown as Env;
    const r = await adminIndexData(withCookie(`CF_Authorization=${jwt}`), e);
    expect(r.connected).toBe(false);
    await adminIndexData(withCookie("CF_Authorization=forged"), e).then(
      () => expect.unreachable(),
      (x: unknown) => expect((x as Response).status).toBe(401),
    );
  });
});

describe("updateSession", () => {
  const req = (cookie?: string) =>
    new Request(
      "https://x.test/",
      cookie ? { headers: { Cookie: cookie } } : {},
    );
  const read = (sc: string) => readGallerySession(reqWithCookie(sc), g1, env);

  it("merges the patch into the previous session", async () => {
    const first = await gallerySessionCookie(
      {
        galleryId: G1,
        unlocked: true,
        visitorId: "v1",
        viewed: true,
        pf: await PF_NONE(),
      },
      env,
      { secure: false },
    );
    const sc = await updateSession(
      req(first.split(";")[0]),
      g1,
      { visitorId: "v2" },
      env,
    );
    expect(await read(sc)).toMatchObject({
      unlocked: true,
      visitorId: "v2",
      viewed: true,
    });
  });

  it("starts from defaults without a previous session and sets pf", async () => {
    const sc = await updateSession(req(), g1, { unlocked: false }, env);
    expect(await read(sc)).toMatchObject({ galleryId: G1, unlocked: false });
  });

  it("sets Secure only over https", async () => {
    const https = await updateSession(
      new Request("https://x.test/"),
      g1,
      {},
      env,
    );
    const http = await updateSession(
      new Request("http://x.test/"),
      g1,
      {},
      env,
    );
    expect(https).toContain("Secure");
    expect(http).not.toContain("Secure");
  });

  it("does not carry over a session whose PIN fingerprint is stale", async () => {
    const old = await gallerySessionCookie(
      { galleryId: G1, unlocked: true, visitorId: "v1", pf: await PF_NONE() },
      env,
      { secure: false },
    );
    const withPin = { id: G1, pinHash: "pbkdf2$x" };
    const sc = await updateSession(req(old.split(";")[0]), withPin, {}, env);
    const s = await readGallerySession(reqWithCookie(sc), withPin, env);
    expect(s?.visitorId).toBeUndefined();
  });
});
