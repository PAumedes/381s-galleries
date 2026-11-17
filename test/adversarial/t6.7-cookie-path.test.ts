import { describe, expect, it } from "vitest";
import { adminLangCookie, isAdminPath } from "../../app/i18n/lang";
import { messagesForRequest } from "../../app/i18n/dictionaries";

// RFC 6265 5.1.4 path-match
function pathMatches(cookiePath: string, reqPath: string): boolean {
  if (cookiePath === reqPath) return true;
  if (reqPath.startsWith(cookiePath)) {
    if (cookiePath.endsWith("/")) return true;
    if (reqPath[cookiePath.length] === "/") return true;
  }
  return false;
}

describe("T6.7 adversarial: admin_lang cookie scope", () => {
  const path = /Path=([^;]+)/.exec(adminLangCookie("en"))![1]!;

  it("cookie is sent on the admin index single-fetch request /admin.data", () => {
    expect(isAdminPath("/admin.data")).toBe(true);
    expect(pathMatches(path, "/admin.data")).toBe(true);
  });

  it("cookie is sent on /admin and /admin/g/1.data (sanity)", () => {
    expect(pathMatches(path, "/admin")).toBe(true);
    expect(pathMatches(path, "/admin/g/1.data")).toBe(true);
  });

  it("case-variant /Admin/setup (matched by the router) still gets admin messages", () => {
    const req = new Request("https://x.test/Admin/setup", {
      headers: { cookie: "admin_lang=en" },
    });
    expect(messagesForRequest(req).messages).toHaveProperty("admin.lang.label");
  });
});
