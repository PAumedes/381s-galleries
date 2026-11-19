import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";
import { messagesForRequest } from "../app/i18n/dictionaries";
import { isAdmin } from "../app/lib/server/auth";
import { loader as rootLoader } from "../app/root";
import { nonceContext } from "../app/lib/server/context";

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});

const adminKeys = (m: Record<string, string>) =>
  Object.keys(m).filter((k) => k.startsWith("admin."));

describe("messagesForRequest", () => {
  const req = new Request("https://x.test/admin", {
    headers: { cookie: "admin_lang=en" },
  });
  it("unverified admin path gets public messages, in the admin language", () => {
    const r = messagesForRequest(req);
    expect(adminKeys(r.messages)).toEqual([]);
    expect(r.lang).toBe("en");
  });
  it("verified admin on an admin path gets the admin dictionary", () => {
    expect(
      adminKeys(messagesForRequest(req, true).messages).length,
    ).toBeGreaterThan(300);
  });
  it("verified flag never unlocks a public path", () => {
    const pub = new Request("https://x.test/g/abc");
    expect(adminKeys(messagesForRequest(pub, true).messages)).toEqual([]);
  });
});

describe("root loader with a verified admin (local dev exception)", () => {
  it("ships admin strings", async () => {
    const e = env as unknown as Record<string, string>;
    const prev = [e.ALLOW_DEV_ADMIN, e.DRIVE_MODE];
    e.ALLOW_DEV_ADMIN = "1";
    e.DRIVE_MODE = "mock";
    try {
      const c = new RouterContextProvider();
      c.set(nonceContext, "n");
      const r = (await rootLoader({
        request: new Request("http://localhost/admin.data?_routes=root"),
        context: c,
      } as never)) as { data?: unknown };
      const p = (r.data ?? r) as { messages: Record<string, string> };
      expect(adminKeys(p.messages).length).toBeGreaterThan(300);
    } finally {
      [e.ALLOW_DEV_ADMIN, e.DRIVE_MODE] = prev as [string, string];
    }
  });
});

describe("isAdmin", () => {
  it("is cached per request (one verification for root loader + route)", async () => {
    const r = new Request("https://x.test/admin");
    const e = { ...env };
    const a = isAdmin(r, e);
    expect(isAdmin(r, e)).toBe(a);
    expect(await a).toBe(false);
  });
});
