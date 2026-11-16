import { describe, expect, it } from "vitest";
import { getLang, langCookie, SUPPORTED_LANGS } from "../app/i18n/lang";
import { interpolate, makeT, plural } from "../app/i18n/t";
import { es } from "../app/i18n/es";
import { en } from "../app/i18n/en";

const req = (url = "https://x.test/", headers: Record<string, string> = {}) =>
  new Request(url, { headers });

describe("getLang", () => {
  it("defaults to es", () => {
    expect(getLang(req())).toBe("es");
  });
  it("?lang= wins over cookie and header", () => {
    expect(
      getLang(
        req("https://x.test/?lang=en", {
          cookie: "lang=es",
          "accept-language": "es",
        }),
      ),
    ).toBe("en");
  });
  it("invalid ?lang= falls through to cookie", () => {
    expect(getLang(req("https://x.test/?lang=fr", { cookie: "lang=en" }))).toBe(
      "en",
    );
  });
  it("cookie wins over Accept-Language", () => {
    expect(
      getLang(
        req("https://x.test/", {
          cookie: "a=b; lang=es; c=d",
          "accept-language": "en",
        }),
      ),
    ).toBe("es");
  });
  it("invalid cookie falls through to Accept-Language", () => {
    expect(
      getLang(
        req("https://x.test/", {
          cookie: "lang=de",
          "accept-language": "en-US",
        }),
      ),
    ).toBe("en");
  });
  it("uses primary subtag", () => {
    expect(
      getLang(req("https://x.test/", { "accept-language": "en-GB" })),
    ).toBe("en");
    expect(
      getLang(req("https://x.test/", { "accept-language": "es-AR" })),
    ).toBe("es");
  });
  it("respects q-values", () => {
    expect(
      getLang(
        req("https://x.test/", { "accept-language": "es;q=0.4, en;q=0.9" }),
      ),
    ).toBe("en");
    expect(
      getLang(
        req("https://x.test/", { "accept-language": "fr, en;q=0.2, es;q=0.1" }),
      ),
    ).toBe("en");
  });
  it("ignores q=0 and garbage", () => {
    expect(
      getLang(req("https://x.test/", { "accept-language": "en;q=0, es" })),
    ).toBe("es");
    expect(
      getLang(req("https://x.test/", { "accept-language": ";;;,*,q=x" })),
    ).toBe("es");
    expect(
      getLang(req("https://x.test/", { "accept-language": "fr, de" })),
    ).toBe("es");
  });
  it("is case-insensitive on values", () => {
    expect(getLang(req("https://x.test/?lang=EN"))).toBe("en");
  });
  it("exports supported langs", () => {
    expect(SUPPORTED_LANGS).toEqual(["es", "en"]);
  });
});

describe("langCookie", () => {
  it("builds a 1-year Lax cookie", () => {
    const c = langCookie("en");
    expect(c).toContain("lang=en");
    expect(c).toContain("Max-Age=31536000");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
  });
});

describe("interpolate / plural / t", () => {
  it("interpolates {var}", () => {
    expect(interpolate("{n} / {total}", { n: 3, total: 10 })).toBe("3 / 10");
  });
  it("leaves unknown vars intact", () => {
    expect(interpolate("a {x} b", {})).toBe("a {x} b");
  });
  it("does not interpret prototype keys", () => {
    expect(interpolate("{constructor}", {})).toBe("{constructor}");
  });
  it("plural picks form via Intl.PluralRules", () => {
    expect(plural("es", 1, { one: "foto", other: "fotos" })).toBe("foto");
    expect(plural("es", 5, { one: "foto", other: "fotos" })).toBe("fotos");
    expect(plural("en", 0, { one: "photo", other: "photos" })).toBe("photos");
  });
  it("t looks up and interpolates", () => {
    const t = makeT("en", en);
    expect(t("lightbox.counter", { n: 12, total: 340 })).toBe("12 / 340");
    expect(t("footer.copyright", { year: 2026 })).toBe("© 2026 381 Studios");
  });
  it("t handles photo count plurals", () => {
    const t = makeT("es", es);
    expect(t("gallery.photoCount", { count: 1 })).toBe("1 foto");
    expect(t("gallery.photoCount", { count: 340 })).toBe("340 fotos");
    const te = makeT("en", en);
    expect(te("gallery.photoCount", { count: 1 })).toBe("1 photo");
    expect(te("gallery.photoCount", { count: 2 })).toBe("2 photos");
  });
  it("download labels match the spec", () => {
    const t = makeT("en", en);
    expect(t("download.high")).toBe("High resolution · 2048 px");
    expect(t("download.web")).toBe("Web · 1200 px");
    expect(t("download.instagram")).toBe("Instagram · 1080 px");
  });
});

describe("key parity", () => {
  it("es and en have identical key sets at runtime", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });
});
