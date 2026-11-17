import { describe, expect, it } from "vitest";
import {
  ADMIN_LANG_COOKIE,
  adminLangCookie,
  getAdminLang,
  getRequestLang,
} from "../app/i18n/lang";
import { en } from "../app/i18n/en";
import { es } from "../app/i18n/es";
import {
  allMessages,
  publicMessages,
  requestT,
} from "../app/i18n/dictionaries";
import {
  fmtBaDateTime,
  fmtNumber,
  fmtPlainDate,
  localeFor,
} from "../app/i18n/format";

const req = (
  url = "https://x.test/admin",
  headers: Record<string, string> = {},
) => new Request(url, { headers });

describe("getAdminLang", () => {
  it("defaults to es (ignores Accept-Language)", () => {
    expect(getAdminLang(req())).toBe("es");
    expect(
      getAdminLang(req("https://x.test/admin", { "accept-language": "en-US" })),
    ).toBe("es");
  });
  it("reads the admin_lang cookie", () => {
    expect(getAdminLang(req(undefined, { cookie: "a=b; admin_lang=en" }))).toBe(
      "en",
    );
    expect(getAdminLang(req(undefined, { cookie: "admin_lang=es" }))).toBe(
      "es",
    );
  });
  it("falls back to es for any invalid value", () => {
    for (const v of [
      "fr",
      "EN",
      "",
      "en%20",
      "en en",
      "../../",
      "<script>",
      "null",
    ])
      expect(getAdminLang(req(undefined, { cookie: `admin_lang=${v}` }))).toBe(
        "es",
      );
  });
  it("ignores the public lang cookie and ?lang=", () => {
    expect(
      getAdminLang(req("https://x.test/admin?lang=en", { cookie: "lang=en" })),
    ).toBe("es");
  });
});

describe("adminLangCookie", () => {
  it("is Path=/admin, Lax, one year", () => {
    const c = adminLangCookie("en");
    expect(c).toContain(`${ADMIN_LANG_COOKIE}=en`);
    expect(c).toContain("Path=/admin");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=31536000");
    expect(c).not.toContain("Secure");
  });
  it("adds Secure when asked", () => {
    expect(adminLangCookie("es", true)).toContain("Secure");
  });
});

describe("getRequestLang (root loader)", () => {
  const cookie = { cookie: "admin_lang=en" };
  it("uses the admin cookie on /admin paths", () => {
    expect(getRequestLang(req("https://x.test/admin", cookie))).toBe("en");
    expect(getRequestLang(req("https://x.test/admin/setup", cookie))).toBe(
      "en",
    );
  });
  it("honours the cookie on .data requests", () => {
    expect(getRequestLang(req("https://x.test/admin.data", cookie))).toBe("en");
    expect(
      getRequestLang(
        req("https://x.test/admin/g/abc.data?_routes=root", cookie),
      ),
    ).toBe("en");
  });
  it("public pages keep the public mechanism", () => {
    expect(getRequestLang(req("https://x.test/boda", cookie))).toBe("es");
    expect(getRequestLang(req("https://x.test/administrador", cookie))).toBe(
      "es",
    );
    expect(
      getRequestLang(req("https://x.test/boda", { cookie: "lang=en" })),
    ).toBe("en");
  });
  it("admin ignores ?lang= and the public cookie", () => {
    expect(
      getRequestLang(
        req("https://x.test/admin?lang=en", { cookie: "lang=en" }),
      ),
    ).toBe("es");
  });
});

describe("dictionaries", () => {
  it("every key exists in es and en and no value is empty", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    for (const [k, v] of Object.entries(es))
      expect(v.trim(), `es ${k}`).not.toBe("");
    for (const [k, v] of Object.entries(en))
      expect(v.trim(), `en ${k}`).not.toBe("");
  });
  it("has admin keys, and en differs from es for admin copy", () => {
    const keys = Object.keys(es).filter((k) => k.startsWith("admin."));
    expect(keys.length).toBeGreaterThan(100);
    const same = keys.filter(
      (k) =>
        (es as Record<string, string>)[k] === (en as Record<string, string>)[k],
    );
    // brand names / tokens may match; prose must not
    expect(same.length).toBeLessThan(keys.length / 5);
  });
  it("same {placeholders} in both languages", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of Object.keys(es))
      expect(ph((en as Record<string, string>)[k]), k).toBe(
        ph((es as Record<string, string>)[k]),
      );
  });
  it("public pages do not receive admin strings", () => {
    expect(
      Object.keys(publicMessages("en")).some((k) => k.startsWith("admin.")),
    ).toBe(false);
    expect(Object.keys(publicMessages("es")).length).toBeGreaterThan(50);
    expect(
      Object.keys(allMessages("en")).some((k) => k.startsWith("admin.")),
    ).toBe(true);
  });
  it("requestT translates from the admin cookie, invalid -> es", () => {
    const k = "admin.nav.galleries" as never;
    expect(requestT(req(undefined, { cookie: "admin_lang=en" }))(k)).toBe(
      "Galleries",
    );
    expect(requestT(req(undefined, { cookie: "admin_lang=xx" }))(k)).toBe(
      "Galerías",
    );
    expect(requestT(req())(k)).toBe("Galerías");
  });
});

describe("formats", () => {
  it("locales", () => {
    expect(localeFor("es")).toBe("es-AR");
    expect(localeFor("en")).toBe("en");
  });
  it("BA date-time per language", () => {
    expect(fmtBaDateTime("es", "2026-11-16T13:05:09Z")).toBe(
      "16/11/2026 10:05",
    );
    expect(
      fmtBaDateTime("en", "2026-11-16T13:05:09Z").replace(/\s/g, " "),
    ).toBe("Nov 16, 2026, 10:05 AM");
    expect(fmtBaDateTime("es", "2026-11-16T02:30:00Z")).toBe(
      "15/11/2026 23:30",
    );
    expect(fmtBaDateTime("en", "garbage")).toBe("");
  });
  it("plain dates and numbers", () => {
    expect(fmtPlainDate("es", "2026-11-01")).toBe("01/11/2026");
    expect(fmtPlainDate("en", "2026-11-01")).toBe("Nov 1, 2026");
    expect(fmtPlainDate("en", "nope")).toBe("nope");
    expect(fmtNumber("es", 1234567)).toBe("1.234.567");
    expect(fmtNumber("en", 1234567)).toBe("1,234,567");
  });
});
