import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shape } from "./support/http";
import {
  ADMIN_ASSET_PREFIX,
  adminAssetResponse,
} from "../app/lib/server/admin-assets";
import { resetAccessKeyCache } from "../app/lib/server/auth";
import { b64urlEncode } from "../app/lib/server/crypto";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag-123";
const KID = "kid1";
const ORIGIN = "https://gallery.test";

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
async function makeJwt(priv: CryptoKey, claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: [AUD],
    iss: `https://${TEAM}`,
    email: "admin@example.com",
    exp: now + 300,
    nbf: now - 10,
    ...claims,
  };
  const h = b64urlEncode(JSON.stringify({ alg: "RS256", kid: KID }));
  const p = b64urlEncode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    priv,
    te.encode(`${h}.${p}`),
  );
  return `${h}.${p}.${b64urlEncode(new Uint8Array(sig))}`;
}

describe("adminAssetResponse", () => {
  let pair: CryptoKeyPair;
  let other: CryptoKeyPair;
  let assetsFetch: ReturnType<typeof vi.fn>;
  let env: Parameters<typeof adminAssetResponse>[1];

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
    assetsFetch = vi.fn(
      async () =>
        new Response("export default 1;", {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=0, must-revalidate",
            ETag: '"abc"',
          },
        }),
    );
    env = {
      ADMIN_EMAIL: "Admin@Example.com",
      DRIVE_MODE: "google",
      ACCESS_TEAM_DOMAIN: TEAM,
      ACCESS_AUD: AUD,
      ASSETS: { fetch: assetsFetch } as unknown as Fetcher,
    };
  });
  afterEach(() => vi.unstubAllGlobals());

  const get = (
    path: string,
    headers: Record<string, string> = {},
    method = "GET",
  ) => new Request(`${ORIGIN}${path}`, { method, headers });
  const asAdmin = async (path: string, method = "GET") =>
    get(
      path,
      {
        "Cf-Access-Jwt-Assertion": await makeJwt(pair.privateKey),
        "Cf-Access-Authenticated-User-Email": "admin@example.com",
      },
      method,
    );
  const expectDenied = (res: Response | null) => {
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    expect(res!.headers.get("Cache-Control")).toBe("no-store");
  };

  it("T6.33 404/405 shapes", async () => {
    const denied = await adminAssetResponse(
      new Request(`${ORIGIN}/admin-assets/a-1.js`),
      env,
    );
    expect(await shape(denied!)).toEqual({
      status: 404,
      body: "Not found",
      headers: { "cache-control": "no-store", "content-type": "text/plain" },
    });
    const res = await adminAssetResponse(
      await asAdmin("/admin-assets/a-1.js", "POST"),
      env,
    );
    expect(await shape(res!)).toEqual({
      status: 405,
      body: "Method not allowed",
      headers: {
        allow: "GET, HEAD",
        "cache-control": "no-store",
        "content-type": "text/plain;charset=UTF-8",
      },
    });
  });

  it("exposes the prefix", () => {
    expect(ADMIN_ASSET_PREFIX).toBe("/admin-assets/");
  });

  it("ignores every other path (returns null, never touches ASSETS)", async () => {
    for (const p of [
      "/",
      "/admin",
      "/admin-assets",
      "/admin-assetsx/a.js",
      "/assets/a.js",
      "/x/admin-assets/a.js",
      "/img/1/thumb",
    ]) {
      expect(await adminAssetResponse(get(p), env)).toBeNull();
    }
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  describe("non-admins get a bare 404", () => {
    it("no credentials", async () => {
      const res = await adminAssetResponse(get("/admin-assets/a-1.js"), env);
      expectDenied(res);
      expect(await res!.text()).toBe("Not found");
      expect(assetsFetch).not.toHaveBeenCalled();
    });
    it("garbage JWT", async () => {
      const res = await adminAssetResponse(
        get("/admin-assets/a-1.js", {
          "Cf-Access-Jwt-Assertion": "a.b.c",
          "Cf-Access-Authenticated-User-Email": "admin@example.com",
        }),
        env,
      );
      expectDenied(res);
      expect(assetsFetch).not.toHaveBeenCalled();
    });
    it("JWT signed by another key", async () => {
      const jwt = await makeJwt(other.privateKey);
      expectDenied(
        await adminAssetResponse(
          get("/admin-assets/a-1.js", {
            "Cf-Access-Jwt-Assertion": jwt,
            "Cf-Access-Authenticated-User-Email": "admin@example.com",
          }),
          env,
        ),
      );
      expect(assetsFetch).not.toHaveBeenCalled();
    });
    it("valid JWT for a different email", async () => {
      const jwt = await makeJwt(pair.privateKey, { email: "evil@example.com" });
      expectDenied(
        await adminAssetResponse(
          get("/admin-assets/a-1.js", {
            "Cf-Access-Jwt-Assertion": jwt,
            "Cf-Access-Authenticated-User-Email": "evil@example.com",
          }),
          env,
        ),
      );
      expect(assetsFetch).not.toHaveBeenCalled();
    });
    it("forged email header only", async () => {
      expectDenied(
        await adminAssetResponse(
          get("/admin-assets/a-1.js", {
            "Cf-Access-Authenticated-User-Email": "admin@example.com",
          }),
          env,
        ),
      );
    });
    it("forged CF_Authorization cookie", async () => {
      expectDenied(
        await adminAssetResponse(
          get("/admin-assets/a-1.js", { Cookie: "CF_Authorization=forged" }),
          env,
        ),
      );
    });
    it("the local dev bypass does not apply off localhost", async () => {
      env = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" };
      expectDenied(await adminAssetResponse(get("/admin-assets/a-1.js"), env));
    });
    it("the 404 reveals nothing about existence (same for missing files)", async () => {
      const a = await adminAssetResponse(get("/admin-assets/a-1.js"), env);
      const b = await adminAssetResponse(get("/admin-assets/nope.js"), env);
      expect(await a!.text()).toBe(await b!.text());
    });
    it("non-admin non-GET methods are 404 too", async () => {
      for (const m of ["POST", "PUT", "DELETE", "OPTIONS", "HEAD"]) {
        expectDenied(
          await adminAssetResponse(get("/admin-assets/a.js", {}, m), env),
        );
      }
    });
  });

  describe("admin", () => {
    it("serves the asset with private immutable caching (header JWT)", async () => {
      const res = await adminAssetResponse(
        await asAdmin("/admin-assets/admin.g._id-BxwF2k1_.js"),
        env,
      );
      expect(res!.status).toBe(200);
      expect(await res!.text()).toBe("export default 1;");
      expect(res!.headers.get("Cache-Control")).toBe(
        "private, max-age=31536000, immutable",
      );
      expect(res!.headers.get("Content-Type")).toContain("javascript");
      expect(res!.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(assetsFetch).toHaveBeenCalledTimes(1);
      const forwarded = assetsFetch.mock.calls[0][0] as Request;
      expect(new URL(forwarded.url).pathname).toBe(
        "/admin-assets/admin.g._id-BxwF2k1_.js",
      );
      expect(forwarded.method).toBe("GET");
    });

    it("falls back to the CF_Authorization cookie", async () => {
      const jwt = await makeJwt(pair.privateKey);
      const res = await adminAssetResponse(
        get("/admin-assets/a-1.js", { Cookie: `x=1; CF_Authorization=${jwt}` }),
        env,
      );
      expect(res!.status).toBe(200);
    });

    it("accepts the local dev bypass on localhost (mock + ALLOW_DEV_ADMIN)", async () => {
      env = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" };
      const res = await adminAssetResponse(
        new Request("http://localhost:5186/admin-assets/a-1.js"),
        env,
      );
      expect(res!.status).toBe(200);
    });

    it("HEAD is served (no body), forwarded as HEAD", async () => {
      assetsFetch.mockResolvedValue(
        new Response(null, { headers: { "Content-Type": "text/javascript" } }),
      );
      const res = await adminAssetResponse(
        await asAdmin("/admin-assets/a-1.js", "HEAD"),
        env,
      );
      expect(res!.status).toBe(200);
      expect(res!.headers.get("Cache-Control")).toContain("immutable");
      expect((assetsFetch.mock.calls[0][0] as Request).method).toBe("HEAD");
    });

    it("other methods get 405 and never reach ASSETS", async () => {
      for (const m of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        const res = await adminAssetResponse(
          await asAdmin("/admin-assets/a-1.js", m),
          env,
        );
        expect(res!.status).toBe(405);
        expect(res!.headers.get("Allow")).toBe("GET, HEAD");
        expect(res!.headers.get("Cache-Control")).toBe("no-store");
      }
      expect(assetsFetch).not.toHaveBeenCalled();
    });

    it("a missing file is a no-store 404, never cached as immutable", async () => {
      assetsFetch.mockResolvedValue(new Response("nf", { status: 404 }));
      const res = await adminAssetResponse(
        await asAdmin("/admin-assets/gone-1.js"),
        env,
      );
      expect(res!.status).toBe(404);
      expect(res!.headers.get("Cache-Control")).toBe("no-store");
    });

    it("forwards a conditional request and keeps a 304 private", async () => {
      assetsFetch.mockResolvedValue(
        new Response(null, { status: 304, headers: { ETag: '"abc"' } }),
      );
      const req = await asAdmin("/admin-assets/a-1.js");
      req.headers.set("If-None-Match", '"abc"');
      const res = await adminAssetResponse(req, env);
      expect(res!.status).toBe(304);
      expect(res!.headers.get("Cache-Control")).toContain("private");
      const fwd = assetsFetch.mock.calls[0][0] as Request;
      expect(fwd.headers.get("If-None-Match")).toBe('"abc"');
    });

    it("never forwards credentials to the assets binding", async () => {
      await adminAssetResponse(await asAdmin("/admin-assets/a-1.js"), env);
      const fwd = assetsFetch.mock.calls[0][0] as Request;
      expect(fwd.headers.get("Cf-Access-Jwt-Assertion")).toBeNull();
      expect(fwd.headers.get("Cookie")).toBeNull();
    });
  });

  describe("path hardening (even for the admin)", () => {
    const paths = [
      // case variants of the prefix: denied to everyone, ASSETS untouched
      "/Admin-Assets/a-1.js",
      "/ADMIN-ASSETS/a-1.js",
      "/admin-ASSETS/a-1.js",
      // empty / directory / dotfile / nested
      "/admin-assets/",
      "/admin-assets//a-1.js",
      "/admin-assets/.assetsignore",
      "/admin-assets/.hidden.js",
      "/admin-assets/sub/a-1.js",
      "/admin-assets/a-1.js/",
      // encoded characters
      "/admin-assets/%2e%2e%2fassets%2fentry.client.js",
      "/admin-assets/..%2fentry.client.js",
      "/admin-assets/a%2F..%2F..%2Fx.js",
      "/admin-assets/%252e%252e/x.js",
      "/admin-assets/a%00.js",
      "/admin-assets/a%20b.js",
      "/admin-assets/a%5c..%5cx.js",
      "/admin-assets/a..b.js",
      "/admin-assets/a;x.js",
      "/admin-assets/a:b.js",
    ];
    for (const p of paths) {
      it(`${p} is refused and never reaches ASSETS`, async () => {
        const res = await adminAssetResponse(await asAdmin(p), env);
        expect(res).not.toBeNull();
        expect(res!.status).toBe(404);
        expect(res!.headers.get("Cache-Control")).toBe("no-store");
        expect(assetsFetch).not.toHaveBeenCalled();
      });
    }

    it("dot segments are normalised away by URL parsing and never leave the prefix", async () => {
      // /admin-assets/../assets/x.js becomes /assets/x.js: not our path at all.
      const res = await adminAssetResponse(
        await asAdmin("/admin-assets/../assets/x.js"),
        env,
      );
      expect(res).toBeNull();
      expect(assetsFetch).not.toHaveBeenCalled();
    });

    it("ignores the query string when forwarding", async () => {
      await adminAssetResponse(
        await asAdmin("/admin-assets/a-1.js?x=../y"),
        env,
      );
      const fwd = assetsFetch.mock.calls[0][0] as Request;
      expect(new URL(fwd.url).pathname).toBe("/admin-assets/a-1.js");
      expect(new URL(fwd.url).search).toBe("");
    });

    it("never serves chunks of unusual-but-legal names outside the charset", async () => {
      const res = await adminAssetResponse(
        await asAdmin("/admin-assets/a$b.js"),
        env,
      );
      expect(res!.status).toBe(404);
    });
  });
});
