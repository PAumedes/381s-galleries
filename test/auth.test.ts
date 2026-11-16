import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  gallerySessionCookie,
  readGallerySession,
  requireAdmin,
} from "../app/lib/server/auth";

const G1 = "11111111-aaaa-bbbb-cccc-000000000001";
const G2 = "22222222-aaaa-bbbb-cccc-000000000002";

function reqWithCookie(setCookie: string) {
  return new Request("https://x.test/", {
    headers: { Cookie: setCookie.split(";")[0] },
  });
}

describe("gallery session cookie", () => {
  it("roundtrips and sets attributes", async () => {
    const sc = await gallerySessionCookie(
      { galleryId: G1, unlocked: true, visitorId: "v1" },
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
    expect(await readGallerySession(reqWithCookie(sc), G1, env)).toEqual({
      galleryId: G1,
      unlocked: true,
      visitorId: "v1",
    });
  });
  it("omits Secure in dev", async () => {
    const sc = await gallerySessionCookie(
      { galleryId: G1, unlocked: false },
      env,
      {
        secure: false,
      },
    );
    expect(sc).not.toContain("Secure");
  });
  it("rejects a cookie for another gallery", async () => {
    const sc = await gallerySessionCookie(
      { galleryId: G1, unlocked: true },
      env,
      {
        secure: true,
      },
    );
    expect(await readGallerySession(reqWithCookie(sc), G2, env)).toBeNull();
    // Same cookie name forced onto the other gallery: signed galleryId must still match.
    const forced = new Request("https://x.test/", {
      headers: {
        Cookie: `g_${G2.slice(0, 8)}=${sc.split("=")[1].split(";")[0]}`,
      },
    });
    expect(await readGallerySession(forced, G2, env)).toBeNull();
  });
  it("rejects missing or garbage cookies", async () => {
    expect(
      await readGallerySession(new Request("https://x.test/"), G1, env),
    ).toBeNull();
    const bad = new Request("https://x.test/", {
      headers: { Cookie: `g_${G1.slice(0, 8)}=junk` },
    });
    expect(await readGallerySession(bad, G1, env)).toBeNull();
  });
});

describe("requireAdmin", () => {
  const mk = (url: string, email?: string) =>
    new Request(url, {
      headers: email ? { "Cf-Access-Authenticated-User-Email": email } : {},
    });
  const google = {
    ADMIN_EMAIL: "Admin@Example.com",
    DRIVE_MODE: "google",
  } as const;
  const mock = {
    ADMIN_EMAIL: "Admin@Example.com",
    DRIVE_MODE: "mock",
  } as unknown as Env;

  it("accepts correct email, case-insensitive", () => {
    expect(() =>
      requireAdmin(mk("https://s.test/admin", "ADMIN@example.COM"), google),
    ).not.toThrow();
  });
  it("401 on wrong email", () => {
    try {
      requireAdmin(mk("https://s.test/admin", "evil@example.com"), google);
      expect.unreachable();
    } catch (e) {
      expect((e as Response).status).toBe(401);
    }
  });
  it("401 on missing header in google mode, even on localhost", () => {
    for (const u of ["https://s.test/admin", "http://localhost:5173/admin"]) {
      try {
        requireAdmin(mk(u), google);
        expect.unreachable();
      } catch (e) {
        expect((e as Response).status).toBe(401);
      }
    }
  });
  it("mock mode: ok on localhost, 401 elsewhere", () => {
    expect(() =>
      requireAdmin(mk("http://localhost:5173/admin"), mock),
    ).not.toThrow();
    expect(() =>
      requireAdmin(mk("http://127.0.0.1:5173/admin"), mock),
    ).not.toThrow();
    try {
      requireAdmin(mk("https://session.381studios.ar/admin"), mock);
      expect.unreachable();
    } catch (e) {
      expect((e as Response).status).toBe(401);
    }
  });
});
