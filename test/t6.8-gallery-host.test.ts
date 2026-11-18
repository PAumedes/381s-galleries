import { describe, expect, it } from "vitest";
import { legacyRedirect } from "../app/lib/server/legacy-redirect";

const env = {
  PUBLIC_ORIGIN: "https://gallery.381studios.ar",
  LEGACY_HOSTS: "session.381studios.ar",
};
const old = (path: string, init?: RequestInit) =>
  new Request("https://session.381studios.ar" + path, init);

describe("legacyRedirect", () => {
  it("301s GET to the same path and query on PUBLIC_ORIGIN", () => {
    const r = legacyRedirect(old("/boda-ana?lang=en&x=1"), env)!;
    expect(r.status).toBe(301);
    expect(r.headers.get("Location")).toBe(
      "https://gallery.381studios.ar/boda-ana?lang=en&x=1",
    );
    expect(r.headers.get("Cache-Control")).toBe("public, max-age=86400");
  });
  it("301s HEAD", () => {
    expect(legacyRedirect(old("/a", { method: "HEAD" }), env)!.status).toBe(
      301,
    );
  });
  it("308s POST (keeps method and body)", () => {
    const r = legacyRedirect(
      old("/api/g/x/fav", { method: "POST", body: "a" }),
      env,
    )!;
    expect(r.status).toBe(308);
    expect(r.headers.get("Location")).toBe(
      "https://gallery.381studios.ar/api/g/x/fav",
    );
  });
  it("redirects /img and root", () => {
    expect(
      legacyRedirect(old("/img/abc?v=1"), env)!.headers.get("Location"),
    ).toBe("https://gallery.381studios.ar/img/abc?v=1");
    expect(legacyRedirect(old("/"), env)!.headers.get("Location")).toBe(
      "https://gallery.381studios.ar/",
    );
  });
  it.each([
    "//evil.com",
    "//evil.com/x",
    "/\\evil.com",
    "///evil.com",
    "/%2f%2fevil.com",
  ])("stays on the gallery origin for %s", (p) => {
    const r = legacyRedirect(
      new Request("https://session.381studios.ar" + p),
      env,
    )!;
    expect(new URL(r.headers.get("Location")!).origin).toBe(
      "https://gallery.381studios.ar",
    );
  });
  it("ignores non-legacy hosts", () => {
    expect(
      legacyRedirect(new Request("https://gallery.381studios.ar/x"), env),
    ).toBeNull();
    expect(legacyRedirect(new Request("https://evil.com/x"), env)).toBeNull();
  });
  it("is a no-op when LEGACY_HOSTS is unset or empty", () => {
    expect(
      legacyRedirect(old("/x"), { PUBLIC_ORIGIN: env.PUBLIC_ORIGIN }),
    ).toBeNull();
    expect(
      legacyRedirect(old("/x"), { ...env, LEGACY_HOSTS: " , " }),
    ).toBeNull();
  });
  it.each([
    undefined,
    "",
    "nope",
    "http://gallery.381studios.ar",
    "https://user:pw@gallery.381studios.ar",
    "https://session.381studios.ar",
    "https://Session.381studios.ar.",
  ])("fails closed with an empty 421 when PUBLIC_ORIGIN is %s", async (o) => {
    const r = legacyRedirect(old("/x"), {
      LEGACY_HOSTS: "session.381studios.ar",
      PUBLIC_ORIGIN: o,
    })!;
    expect(r.status).toBe(421);
    expect(r.headers.get("Location")).toBeNull();
    expect(await r.text()).toBe("");
  });
  it("allows http PUBLIC_ORIGIN only for localhost", () => {
    const r = legacyRedirect(old("/x"), {
      LEGACY_HOSTS: env.LEGACY_HOSTS,
      PUBLIC_ORIGIN: "http://localhost:5173",
    })!;
    expect(r.status).toBe(301);
    expect(r.headers.get("Location")).toBe("http://localhost:5173/x");
  });
  it("ignores one trailing dot on request host and LEGACY_HOSTS items, and case", () => {
    expect(
      legacyRedirect(new Request("https://SESSION.381studios.ar./x"), env),
    ).not.toBeNull();
    const e = { ...env, LEGACY_HOSTS: " ,Session.381studios.ar. , " };
    expect(legacyRedirect(old("/x"), e)!.status).toBe(301);
    expect(
      legacyRedirect(new Request("https://session.381studios.ar../x"), e),
    ).toBeNull();
  });
  it("adds security headers to redirects and 421", () => {
    for (const r of [
      legacyRedirect(old("/x"), env)!,
      legacyRedirect(old("/x"), { LEGACY_HOSTS: env.LEGACY_HOSTS })!,
    ]) {
      expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(r.headers.get("X-Frame-Options")).toBe("DENY");
      expect(r.headers.get("Referrer-Policy")).toBeTruthy();
    }
  });
  it.each([
    "/admin",
    "/Admin/galleries",
    "/ADMIN/google/callback?x=1",
    "/api/admin/foo",
    "/boda?code=abc",
    "/boda?a=1&state=xyz",
  ])("no-store for sensitive path %s", (p) => {
    expect(legacyRedirect(old(p), env)!.headers.get("Cache-Control")).toBe(
      "no-store",
    );
  });
  it.each(["/boda", "/administrador", "/boda?lang=en", "/img/a?v=1"])(
    "keeps public cache for %s",
    (p) => {
      expect(legacyRedirect(old(p), env)!.headers.get("Cache-Control")).toBe(
        "public, max-age=86400",
      );
    },
  );
  it("matches hosts case-insensitively, several entries, and the Host header cannot steer the target", () => {
    const e = { ...env, LEGACY_HOSTS: "a.example.com, Session.381studios.ar" };
    const r = legacyRedirect(old("/x"), e)!;
    expect(r.headers.get("Location")).toBe("https://gallery.381studios.ar/x");
    expect(
      legacyRedirect(new Request("https://a.example.com/y"), e)!.headers.get(
        "Location",
      ),
    ).toBe("https://gallery.381studios.ar/y");
  });
});

import wranglerRaw from "../wrangler.jsonc?raw";
import workerSrc from "../workers/app.ts?raw";

const appFiles = import.meta.glob("../app/**/*.{ts,tsx,css}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("config", () => {
  const cfg = JSON.parse(
    wranglerRaw
      // block comments only at line start: "/admin-assets/*" is a string, not a comment
      .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,(\s*[}\]])/g, "$1"),
  );
  it("has both custom-domain routes and the vars", () => {
    const routes = cfg.routes as { pattern: string; custom_domain: boolean }[];
    for (const p of ["gallery.381studios.ar", "session.381studios.ar"]) {
      expect(routes).toContainEqual({ pattern: p, custom_domain: true });
    }
    expect(cfg.vars.PUBLIC_ORIGIN).toBe("https://gallery.381studios.ar");
    expect(cfg.vars.LEGACY_HOSTS).toBe("session.381studios.ar");
  });
  it("worker entry runs the redirect before anything else", () => {
    const src = workerSrc as string;
    const i = src.indexOf("legacyRedirect(");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(src.indexOf("assertDistinctSecrets(env)"));
    expect(i).toBeLessThan(src.indexOf("requestHandler(request"));
  });
});

describe("no hardcoded legacy host", () => {
  it("app/ never mentions session.381studios", () => {
    expect(Object.keys(appFiles).length).toBeGreaterThan(20);
    const hits = Object.entries(appFiles)
      .filter(([, src]) => src.includes("session.381studios"))
      .map(([f]) => f);
    expect(hits).toEqual([]);
  });
});
