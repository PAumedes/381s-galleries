import { describe, expect, it } from "vitest";
import { legacyRedirect } from "../app/lib/server/legacy-redirect";
import wranglerRaw from "../wrangler.jsonc?raw";
import workerSrc from "../workers/app.ts?raw";
import {
  hostConfigProblems,
  legacyHostsOf,
  parseWrangler,
  type HostConfig,
} from "./support/wrangler-config";

const cfg = parseWrangler(wranglerRaw);
const CANON_ORIGIN = cfg.vars.PUBLIC_ORIGIN;
const CANON = new URL(CANON_ORIGIN).host;
// Any hostname different from the canonical one works for the redirect tests.
const LEGACY = legacyHostsOf(cfg)[0] ?? "legacy.example.test";
const env = { PUBLIC_ORIGIN: CANON_ORIGIN, LEGACY_HOSTS: LEGACY };
const old = (path: string, init?: RequestInit) =>
  new Request(`https://${LEGACY}${path}`, init);

describe("legacyRedirect", () => {
  it("301s GET to the same path and query on PUBLIC_ORIGIN", () => {
    const r = legacyRedirect(old("/boda-ana?lang=en&x=1"), env)!;
    expect(r.status).toBe(301);
    expect(r.headers.get("Location")).toBe(
      `${CANON_ORIGIN}/boda-ana?lang=en&x=1`,
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
    expect(r.headers.get("Location")).toBe(`${CANON_ORIGIN}/api/g/x/fav`);
  });
  it("redirects /img and root", () => {
    expect(
      legacyRedirect(old("/img/abc?v=1"), env)!.headers.get("Location"),
    ).toBe(`${CANON_ORIGIN}/img/abc?v=1`);
    expect(legacyRedirect(old("/"), env)!.headers.get("Location")).toBe(
      `${CANON_ORIGIN}/`,
    );
  });
  it.each([
    "//evil.com",
    "//evil.com/x",
    "/\\evil.com",
    "///evil.com",
    "/%2f%2fevil.com",
  ])("stays on the gallery origin for %s", (p) => {
    const r = legacyRedirect(new Request(`https://${LEGACY}${p}`), env)!;
    expect(new URL(r.headers.get("Location")!).origin).toBe(CANON_ORIGIN);
  });
  it("ignores non-legacy hosts", () => {
    expect(legacyRedirect(new Request(`${CANON_ORIGIN}/x`), env)).toBeNull();
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
    `http://${CANON}`,
    `https://user:pw@${CANON}`,
    `https://${LEGACY}`,
    `https://${LEGACY.toUpperCase()}.`,
  ])("fails closed with an empty 421 when PUBLIC_ORIGIN is %s", async (o) => {
    const r = legacyRedirect(old("/x"), {
      LEGACY_HOSTS: LEGACY,
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
      legacyRedirect(new Request(`https://${LEGACY.toUpperCase()}./x`), env),
    ).not.toBeNull();
    const e = { ...env, LEGACY_HOSTS: ` ,${LEGACY.toUpperCase()}. , ` };
    expect(legacyRedirect(old("/x"), e)!.status).toBe(301);
    expect(legacyRedirect(new Request(`https://${LEGACY}../x`), e)).toBeNull();
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
    const e = {
      ...env,
      LEGACY_HOSTS: `a.example.com, ${LEGACY.toUpperCase()}`,
    };
    const r = legacyRedirect(old("/x"), e)!;
    expect(r.headers.get("Location")).toBe(`${CANON_ORIGIN}/x`);
    expect(
      legacyRedirect(new Request("https://a.example.com/y"), e)!.headers.get(
        "Location",
      ),
    ).toBe(`${CANON_ORIGIN}/y`);
  });
});

const appFiles = import.meta.glob("../app/**/*.{ts,tsx,css}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("config", () => {
  it("has both custom-domain routes and the vars", () => {
    expect(hostConfigProblems(cfg)).toEqual([]);
  });
  it("detects a missing route", () => {
    const c = structuredClone(cfg);
    c.routes = c.routes.filter((r) => r.pattern !== CANON);
    expect(hostConfigProblems(c)).not.toEqual([]);
    const l = structuredClone(cfg);
    l.vars.LEGACY_HOSTS = "other.example.test";
    expect(hostConfigProblems(l)).toContain(
      "no route for legacy host other.example.test",
    );
  });
  it("detects a PUBLIC_ORIGIN host mismatch, bad legacy host, non custom domain, empty name", () => {
    const m = structuredClone(cfg);
    m.vars.PUBLIC_ORIGIN = "https://elsewhere.example.test";
    expect(hostConfigProblems(m)).toContain(
      "no route for the PUBLIC_ORIGIN host",
    );
    const e = structuredClone(cfg);
    e.vars.LEGACY_HOSTS = CANON;
    expect(hostConfigProblems(e)).toContain(
      `legacy host equals canonical: ${CANON}`,
    );
    const b = structuredClone(cfg);
    b.vars.LEGACY_HOSTS = "https://x.example.test/p";
    expect(hostConfigProblems(b).join()).toContain("not a hostname");
    const n = structuredClone(cfg);
    n.routes[0].custom_domain = false;
    expect(hostConfigProblems(n)).not.toEqual([]);
    const s = structuredClone(cfg);
    s.vars.STUDIO_NAME = "  ";
    expect(hostConfigProblems(s)).toContain(
      "STUDIO_NAME must be a non-empty string",
    );
  });
  it.each([
    [
      "fork, no legacy host",
      "luz.example",
      "",
      [{ pattern: "luz.example", custom_domain: true }],
    ],
    [
      "fork with a legacy host",
      "galeria.estudio.example",
      "vieja.estudio.example",
      [
        { pattern: "galeria.estudio.example", custom_domain: true },
        { pattern: "vieja.estudio.example", custom_domain: true },
      ],
    ],
  ])("accepts a different domain: %s", (_n, host, legacy, routes) => {
    const fork: HostConfig = {
      routes,
      vars: {
        STUDIO_NAME: "Estudio Luz",
        PUBLIC_ORIGIN: `https://${host}`,
        LEGACY_HOSTS: legacy,
      },
    };
    expect(hostConfigProblems(fork)).toEqual([]);
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
