import { describe, expect, it } from "vitest";
import {
  gallerySessionCookie,
  pinFingerprint,
  readGallerySession,
  sessionCookieName,
} from "../../app/lib/server/auth";

const env = { SESSION_SECRET: "a-long-random-secret-for-tests-0123456789" };

describe("T0 adversarial: auth", () => {
  it("cookie names do not collide for galleries sharing an 8-char id prefix", () => {
    const a = "abcdef12-0000-4000-8000-000000000001";
    const b = "abcdef12-1111-4000-8000-000000000002";
    expect(sessionCookieName(a)).not.toBe(sessionCookieName(b));
  });

  it("unlocking gallery B does not clobber gallery A's session cookie", async () => {
    const a = "abcdef12-0000-4000-8000-000000000001";
    const b = "abcdef12-1111-4000-8000-000000000002";
    const ca = await gallerySessionCookie(
      { galleryId: a, unlocked: true, pf: await pinFingerprint(null, env) },
      env,
      {
        secure: true,
      },
    );
    const cb = await gallerySessionCookie(
      { galleryId: b, unlocked: true, pf: await pinFingerprint(null, env) },
      env,
      {
        secure: true,
      },
    );
    // Browser keeps one cookie per name; with colliding names only the last survives.
    const jar = new Map<string, string>();
    for (const c of [ca, cb]) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const req = new Request("https://x.test/", {
      headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
    });
    expect(
      await readGallerySession(req, { id: a, pinHash: null }, env),
    ).not.toBeNull();
    expect(
      await readGallerySession(req, { id: b, pinHash: null }, env),
    ).not.toBeNull();
  });

  it("a stale/forged cookie of the same name does not shadow a valid one", async () => {
    const a = "abcdef12-0000-4000-8000-000000000001";
    const c = await gallerySessionCookie(
      { galleryId: a, unlocked: true, pf: await pinFingerprint(null, env) },
      env,
      {
        secure: true,
      },
    );
    const good = c.split(";")[0];
    const name = sessionCookieName(a);
    const req = new Request("https://x.test/", {
      headers: { Cookie: `${name}=junk; ${good}` },
    });
    expect(
      await readGallerySession(req, { id: a, pinHash: null }, env),
    ).not.toBeNull();
  });
});
