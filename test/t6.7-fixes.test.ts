import { describe, expect, it } from "vitest";
import {
  adminLangCookie,
  getAdminLang,
  getRequestLang,
  isAdminPath,
  legacyAdminLangCookieExpiry,
} from "../app/i18n/lang";
import { messagesForRequest } from "../app/i18n/dictionaries";
import { requireAdmin } from "../app/lib/server/auth";

const req = (path: string, cookie?: string) =>
  new Request(`https://x.test${path}`, cookie ? { headers: { cookie } } : {});

describe("admin_lang cookie path", () => {
  it("is Path=/ with the other attributes kept", () => {
    const c = adminLangCookie("en", true);
    expect(c).toContain("admin_lang=en");
    expect(c).toContain("Path=/;");
    expect(c).not.toContain("Path=/admin");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=31536000");
    expect(c).toContain("Secure");
  });
  it("expires the legacy Path=/admin cookie", () => {
    const c = legacyAdminLangCookieExpiry();
    expect(c).toContain("admin_lang=");
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("Path=/admin");
  });
  it("public pages ignore admin_lang", () => {
    expect(getRequestLang(req("/g/x", "admin_lang=en"))).toBe("es");
    expect(
      messagesForRequest(req("/", "admin_lang=en")).messages,
    ).not.toHaveProperty("admin.lang.label");
  });
});

describe("duplicate admin_lang cookies", () => {
  it("first valid value wins (more specific path is sent first)", () => {
    expect(getAdminLang(req("/admin", "admin_lang=en; admin_lang=es"))).toBe(
      "en",
    );
    expect(getAdminLang(req("/admin", "admin_lang=es; admin_lang=en"))).toBe(
      "es",
    );
  });
  it("skips invalid values", () => {
    expect(getAdminLang(req("/admin", "admin_lang=xx; admin_lang=en"))).toBe(
      "en",
    );
    expect(getAdminLang(req("/admin", "admin_lang=; admin_lang=xx"))).toBe(
      "es",
    );
  });
});

describe("case-insensitive admin paths", () => {
  it.each([
    "/Admin/setup",
    "/ADMIN",
    "/Admin.data",
    "/ADMIN/g/1.DATA",
    "/admin/",
  ])("%s is admin", (p) => {
    expect(isAdminPath(p)).toBe(true);
    expect(getRequestLang(req(p, "admin_lang=en"))).toBe("en");
    expect(
      messagesForRequest(req(p, "admin_lang=en"), true).messages,
    ).toHaveProperty("admin.lang.label");
  });
  it.each(["/administrator", "/admins.data", "/g/admin"])("%s is not", (p) => {
    expect(isAdminPath(p)).toBe(false);
  });
  it("requireAdmin gives 401 on /ADMIN without or with a bad JWT", async () => {
    const env = {
      ADMIN_EMAIL: "a@example.com",
      DRIVE_MODE: "google",
      ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com",
      ACCESS_AUD: "aud",
    } as never;
    for (const headers of [
      {},
      {
        "Cf-Access-Authenticated-User-Email": "a@example.com",
        "Cf-Access-Jwt-Assertion": "a.b.c",
      },
      { cookie: "CF_Authorization=a.b.c" },
    ]) {
      const e = await requireAdmin(
        new Request("https://x.test/ADMIN", { headers }),
        env,
      ).then(
        () => null,
        (x: unknown) => x,
      );
      expect((e as Response).status).toBe(401);
    }
  });
});
