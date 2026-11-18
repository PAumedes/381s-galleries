import { describe, expect, it } from "vitest";
import {
  cleanText,
  primaryLanguage,
  referrerHost,
  visitorInfo,
} from "../app/lib/server/visitor-info";

const ENV = {
  SESSION_SECRET: "test-session-secret-0123456789-abcdefghij",
  DRIVE_MODE: "mock",
} as never;

const req = (
  headers: Record<string, string> = {},
  cf?: Record<string, unknown>,
  url = "https://gallery.test/boda",
) => {
  const r = new Request(url, { headers });
  if (cf) Object.defineProperty(r, "cf", { value: cf });
  return r;
};

describe("cleanText", () => {
  it("strips control characters, trims, caps length", () => {
    expect(cleanText("  Bue\u0000nos\u0007 \r\n Aires\t", 50)).toBe(
      "Buenos Aires",
    );
    expect(cleanText("a".repeat(500), 10)).toBe("a".repeat(10));
  });
  it("strips bidi / line-separator tricks", () => {
    expect(cleanText("a‮b c⁦d​e", 20)).toBe("abcde");
  });
  it("does not split a surrogate pair at the cap", () => {
    const s = cleanText("ab😀cd", 3);
    expect(s).toBe("ab");
    expect(s && s.charCodeAt(s.length - 1)).toBeLessThan(0xd800);
  });
  it("non-strings and empty results are null", () => {
    for (const v of [null, undefined, 5, {}, [], "", "   ", "\u0000\u0001"])
      expect(cleanText(v, 10)).toBeNull();
  });
});

describe("primaryLanguage", () => {
  it("takes only the first tag", () => {
    expect(primaryLanguage("es-AR,es;q=0.9,en;q=0.8")).toBe("es-AR");
    expect(primaryLanguage("en")).toBe("en");
    expect(primaryLanguage("  fr-CH , de")).toBe("fr-CH");
    expect(primaryLanguage("zh-Hant-TW;q=0.5")).toBe("zh-Hant-TW");
  });
  it("rejects wildcard, junk, oversized and missing", () => {
    for (const v of [
      null,
      "",
      "*",
      "<script>",
      "=cmd|' /C calc'!A0",
      "es_AR",
      "a",
      "x".repeat(300),
      "es-" + "A".repeat(100),
      ",es",
    ])
      expect(primaryLanguage(v)).toBeNull();
  });
});

describe("referrerHost", () => {
  const site = "gallery.test";
  it("keeps the host only: no path, query, credentials or port", () => {
    expect(
      referrerHost("https://l.instagram.com/?u=https%3A%2F%2Fx&e=SECRET", site),
    ).toBe("l.instagram.com");
    expect(referrerHost("https://user:pw@Example.COM:8443/a/b?c#d", site)).toBe(
      "example.com",
    );
  });
  it("is null for same-site, missing, malformed and non-http", () => {
    expect(referrerHost("https://gallery.test/other", site)).toBeNull();
    expect(referrerHost("https://GALLERY.test/", site)).toBeNull();
    for (const v of [
      null,
      "",
      "not a url",
      "javascript:alert(1)",
      "android-app://com.google.android.gm",
      "data:text/html,x",
      "https://",
      "https://" + "a".repeat(300) + ".com/",
    ])
      expect(referrerHost(v, site)).toBeNull();
  });
});

describe("visitorInfo", () => {
  it("collects everything in one place", async () => {
    const info = await visitorInfo(
      req(
        {
          "CF-Connecting-IP": "203.0.113.77",
          "Accept-Language": "es-AR,es;q=0.9",
          Referer: "https://l.instagram.com/?u=x",
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        },
        {
          country: "AR",
          region: "Buenos Aires",
          regionCode: "B",
          city: "Villa Luro",
          continent: "SA",
          timezone: "America/Argentina/Buenos_Aires",
          asn: 7303,
          asOrganization: "Telecom Argentina S.A.",
        },
      ),
      ENV,
    );
    expect(info).toMatchObject({
      country: "AR",
      region: "Buenos Aires",
      city: "Villa Luro",
      continent: "SA",
      timezone: "America/Argentina/Buenos_Aires",
      asn: 7303,
      asOrg: "Telecom Argentina S.A.",
      lang: "es-AR",
      referrerHost: "l.instagram.com",
      browser: "Safari",
      browserVersion: "17",
      os: "iOS",
      device: "mobile",
    });
    expect(info.ipHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(info)).not.toContain("203.0.113.77");
  });

  it("falls back to regionCode", async () => {
    const info = await visitorInfo(req({}, { regionCode: "B" }), ENV);
    expect(info.region).toBe("B");
  });

  it("without request.cf everything cf-derived is null and nothing throws", async () => {
    const info = await visitorInfo(req({}), ENV);
    expect(info).toMatchObject({
      country: null,
      region: null,
      city: null,
      continent: null,
      timezone: null,
      asn: null,
      asOrg: null,
      lang: null,
      referrerHost: null,
      browser: null,
      browserVersion: null,
      os: null,
      device: "unknown",
    });
  });

  it("never trusts cf/header values: wrong types, control chars, oversize", async () => {
    const info = await visitorInfo(
      req(
        { "Accept-Language": "x".repeat(5000), "User-Agent": "A".repeat(9000) },
        {
          country: "ARG",
          region: "x".repeat(1000),
          city: "Bu\u0000e\nnos",
          continent: { a: 1 },
          timezone: 5,
          asn: "7303; DROP TABLE",
          asOrganization: "=HYPERLINK(" + "x".repeat(500),
        },
      ),
      ENV,
    );
    expect(info.country).toBeNull();
    expect(info.region?.length).toBe(100);
    expect(info.city).toBe("Bue nos");
    expect(info.continent).toBeNull();
    expect(info.timezone).toBeNull();
    expect(info.asn).toBeNull();
    expect(info.asOrg?.length).toBe(100);
    expect(info.lang).toBeNull();
  });

  it("asn must be a safe non-negative integer", async () => {
    for (const asn of [-1, 1.5, NaN, Infinity, 2 ** 40, null])
      expect((await visitorInfo(req({}, { asn }), ENV)).asn).toBeNull();
    expect((await visitorInfo(req({}, { asn: 64512 }), ENV)).asn).toBe(64512);
  });

  it("ipHash is null without a client IP outside mock mode", async () => {
    const live = { ...(ENV as object), DRIVE_MODE: "google" } as never;
    expect((await visitorInfo(req({}), live)).ipHash).toBeNull();
  });
});
