import { describe, expect, it } from "vitest";
import {
  applySecurityHeaders,
  buildCsp,
  makeNonce,
} from "../app/lib/server/security-headers";
import { adminHeaders } from "../app/lib/server/admin";

const NONCE = "abc123NONCE";
const html = (init: ResponseInit = {}) =>
  new Response("<html></html>", {
    ...init,
    headers: { "Content-Type": "text/html", ...(init.headers as object) },
  });

describe("buildCsp", () => {
  it("is the agreed policy in production", () => {
    expect(buildCsp(NONCE, false)).toBe(
      `default-src 'self'; script-src 'self' 'nonce-${NONCE}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com; object-src 'none'`,
    );
  });
  it("allows picsum only in mock mode", () => {
    const m = buildCsp(NONCE, true);
    expect(m).toContain(
      "img-src 'self' data: blob: https://picsum.photos https://fastly.picsum.photos",
    );
    expect(m).toContain(
      "connect-src 'self' https://picsum.photos https://fastly.picsum.photos",
    );
    expect(buildCsp(NONCE, false)).not.toContain("picsum");
  });
});

describe("makeNonce", () => {
  it("is unique, url-safe and at least 128 bits", () => {
    const a = makeNonce();
    expect(a).not.toBe(makeNonce());
    expect(a).toMatch(/^[A-Za-z0-9_-]{22,}$/);
  });
});

describe("applySecurityHeaders", () => {
  it("adds every header to an HTML response, CSP carries the nonce", () => {
    const r = applySecurityHeaders(html(), { nonce: NONCE, mock: false });
    expect(r.headers.get("X-Frame-Options")).toBe("DENY");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(r.headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    expect(r.headers.get("Content-Security-Policy")).toBe(
      buildCsp(NONCE, false),
    );
  });
  it("resource responses get at least the non-CSP headers", () => {
    for (const ct of ["text/csv", "image/jpeg", "application/manifest+json"]) {
      const r = applySecurityHeaders(
        new Response("x", { headers: { "Content-Type": ct } }),
        { nonce: NONCE, mock: false },
      );
      expect(r.headers.get("X-Frame-Options")).toBe("DENY");
      expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(r.headers.get("Permissions-Policy")).toContain("camera=()");
      expect(r.headers.get("Referrer-Policy")).toBeTruthy();
    }
  });
  it("redirects get them too (Google OAuth 302 keeps working)", () => {
    const r = applySecurityHeaders(
      new Response(null, {
        status: 302,
        headers: { Location: "https://accounts.google.com/o/oauth2/v2/auth" },
      }),
      { nonce: NONCE, mock: false },
    );
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(r.headers.get("X-Frame-Options")).toBe("DENY");
  });
  it("keeps stricter per-route values", () => {
    const r = applySecurityHeaders(
      html({
        headers: {
          "Referrer-Policy": "same-origin",
          "X-Frame-Options": "SAMEORIGIN",
          "Content-Security-Policy": "default-src 'none'",
        },
      }),
      { nonce: NONCE, mock: false },
    );
    expect(r.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(r.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(r.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
  });
  it("preserves status, body, other headers and every Set-Cookie", async () => {
    const h = new Headers({ "Content-Type": "text/html", "X-Keep": "1" });
    h.append("Set-Cookie", "a=1; Path=/");
    h.append("Set-Cookie", "b=2; Path=/");
    const r = applySecurityHeaders(
      new Response("hello", { status: 404, headers: h }),
      { nonce: NONCE, mock: false },
    );
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("hello");
    expect(r.headers.get("X-Keep")).toBe("1");
    expect(r.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });
  it("works on responses with immutable headers (fetch / websocket-style)", () => {
    const r = applySecurityHeaders(Response.redirect("https://x.test/a", 302), {
      nonce: NONCE,
      mock: false,
    });
    expect(r.headers.get("X-Frame-Options")).toBe("DENY");
  });
  it("mock mode CSP allows picsum", () => {
    const r = applySecurityHeaders(html(), { nonce: NONCE, mock: true });
    expect(r.headers.get("Content-Security-Policy")).toContain(
      "https://picsum.photos",
    );
  });
});

describe("admin responses", () => {
  it("adminHeaders forbid framing and sniffing", () => {
    const h = adminHeaders();
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
  });
});
