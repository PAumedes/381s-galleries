import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import {
  LOGO_MAX_BYTES,
  getLogoVersions,
  readBodyLimited,
  serveLogo,
  validateLogo,
} from "../app/lib/server/logo";
import { getSetting, putSetting } from "../app/lib/server/settings";
import { setupAction } from "../app/routes/admin.setup";
import { loader as rootLoader } from "../app/root";
import { loader as logoLoader } from "../app/routes/brand.logo.$variant";
import { RouterContextProvider } from "react-router";
import { nonceContext } from "../app/lib/server/context";
import { applySecurityHeaders } from "../app/lib/server/security-headers";
import {
  GIF,
  JPEG,
  PNG,
  SVG_OK,
  WEBP,
  bytes,
  multipart,
  svg,
  webp,
} from "./logo-fixtures";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const nonAdmin = { ...e, ALLOW_DEV_ADMIN: "0" } as Env;

const status = async (p: Promise<unknown>) =>
  ((await p.catch((x) => x)) as Response).status;
const upload = (
  data: Uint8Array,
  over: { variant?: string; name?: string; type?: string } = {},
  headers: HeadersInit = {},
) =>
  multipart(
    {
      intent: "logo",
      variant: over.variant ?? "on-light",
      file: {
        name: over.name ?? "logo.png",
        type: over.type ?? "image/png",
        data,
      },
    },
    headers,
  );
const r2Keys = async () =>
  (await env.CACHE.list({ prefix: "brand/" })).objects.map((o) => o.key);

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});
beforeEach(async () => {
  await getDb(env).delete(schema.settings);
  for (const o of (await env.CACHE.list()).objects)
    await env.CACHE.delete(o.key);
});

describe("validateLogo: raster formats by magic bytes", () => {
  it.each([
    ["png", PNG, "image/png"],
    ["jpeg", JPEG, "image/jpeg"],
    ["webp", WEBP, "image/webp"],
    ["svg", bytes(SVG_OK), "image/svg+xml"],
  ] as const)("accepts a valid %s", (_n, data, type) => {
    expect(validateLogo(data)).toEqual({ ok: true, type });
  });
  it("rejects empty, GIF, HTML, plain text, PDF", () => {
    for (const d of [
      bytes(),
      GIF,
      bytes("<!doctype html><script>alert(1)</script>"),
      bytes("hello"),
      bytes("%PDF-1.4"),
    ])
      expect(validateLogo(d)).toMatchObject({ ok: false });
  });
  it("rejects anything over 512 KB, accepts exactly the limit", () => {
    const pad = (n: number) => bytes(svg(`<!-- ${"a".repeat(n)} -->`));
    const exact = LOGO_MAX_BYTES - pad(0).length;
    expect(validateLogo(pad(exact))).toMatchObject({ ok: true });
    expect(validateLogo(pad(exact + 1))).toEqual({
      ok: false,
      error: "too_large",
    });
  });
  it("rejects polyglots: valid image followed by markup or script", () => {
    expect(validateLogo(bytes(PNG, "<svg onload=alert(1)>"))).toMatchObject({
      ok: false,
    });
    expect(
      validateLogo(bytes(JPEG, "<script>alert(1)</script>")),
    ).toMatchObject({ ok: false });
    expect(validateLogo(bytes(WEBP, "<html>"))).toMatchObject({ ok: false });
  });
  it("rejects truncated or lying containers", () => {
    expect(validateLogo(PNG.slice(0, 20))).toMatchObject({ ok: false });
    expect(validateLogo(PNG.slice(0, 8))).toMatchObject({ ok: false });
    expect(validateLogo(JPEG.slice(0, JPEG.length - 2))).toMatchObject({
      ok: false,
    });
    expect(validateLogo(webp(9999))).toMatchObject({ ok: false });
    expect(validateLogo(bytes("RIFF", [4, 0, 0, 0], "WAVE"))).toMatchObject({
      ok: false,
    });
  });
  it("rejects a PNG whose chunk length points past the end", () => {
    const bad = PNG.slice();
    bad[8] = 0x7f; // IHDR length huge
    expect(validateLogo(bad)).toMatchObject({ ok: false });
  });
});

describe("validateLogo: SVG is accepted only when trivially safe", () => {
  const ok = (s: string | Uint8Array) =>
    validateLogo(typeof s === "string" ? bytes(s) : s);
  it("accepts a typical export (xml decl, comment, style, gradient, use #id, BOM)", () => {
    const doc =
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by tool -->\n' +
      svg(
        '<defs><style>.a{fill:#000;stroke:rgb(0,0,0)}</style><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient><path id="p" d="M0 0h1"/></defs><g class="a" transform="translate(1 2)"><use href="#p"/><rect width="4" height="4" fill="url(#g)"/><title>38 1S</title></g>',
        ' xmlns:xlink="http://www.w3.org/1999/xlink"',
      );
    expect(ok(doc)).toMatchObject({ ok: true });
    expect(ok(bytes([0xef, 0xbb, 0xbf], doc))).toMatchObject({ ok: true });
  });
  it.each([
    ["script element", svg("<script>alert(1)</script>")],
    ["SCRIPT upper-case", svg("<SCRIPT>alert(1)</SCRIPT>")],
    [
      "prefixed script",
      svg('<x:script xmlns:x="http://www.w3.org/2000/svg">1</x:script>'),
    ],
    ["onload on root", svg("", ' onload="alert(1)"')],
    ["onclick on path", svg('<path d="M0 0" onclick="x()"/>')],
    ["ONLOAD upper", svg("", ' ONLOAD="x()"')],
    ["foreignObject", svg("<foreignObject><div>hi</div></foreignObject>")],
    ["image external", svg('<image href="https://evil.example/x.png"/>')],
    ["image data", svg('<image href="data:image/png;base64,AAAA"/>')],
    ["use external", svg('<use href="https://evil.example/a.svg#x"/>')],
    ["use file", svg('<use xlink:href="other.svg#x"/>')],
    ["a javascript", svg('<a href="javascript:alert(1)"><path d="M0 0"/></a>')],
    ["href javascript on use", svg('<use href="javascript:alert(1)"/>')],
    ["href data svg", svg('<use href="data:image/svg+xml,&lt;svg/&gt;"/>')],
    [
      "style @import",
      svg("<style>@import url(https://evil.example/a.css);</style>"),
    ],
    ["style url()", svg("<style>.a{fill:url(https://evil.example/x)}</style>")],
    ["style escape", svg("<style>.a{background:\\75rl(x)}</style>")],
    ["style attr url", svg('<path style="fill:url(http://x/y)" d="M0 0"/>')],
    ["fill external url", svg('<path fill="url(https://x/y#z)" d="M0 0"/>')],
    [
      "animate",
      svg('<animate attributeName="href" values="javascript:alert(1)"/>'),
    ],
    ["set", svg('<set attributeName="onload" to="alert(1)"/>')],
    ["iframe", svg("<iframe src='x'/>")],
    [
      "doctype entity",
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]>${svg("<text>&x;</text>")}`,
    ],
    ["xxe", `<!DOCTYPE svg SYSTEM "http://evil.example/a.dtd">${SVG_OK}`],
    ["entity ref", svg("<text>&amp;</text>")],
    [
      "numeric entity in attr",
      svg('<path d="M0 0" fill="&#106;avascript:x"/>'),
    ],
    ["cdata", svg("<style><![CDATA[.a{fill:red}]]></style>")],
    ["stylesheet PI", `<?xml-stylesheet href="x.css"?>${SVG_OK}`],
    [
      "bad xmlns",
      `<svg xmlns="http://www.w3.org/1999/xhtml"><path d="M0 0"/></svg>`,
    ],
    ["extra xmlns", svg("", ' xmlns:h="http://www.w3.org/1999/xhtml"')],
    ["html root", "<html><body>hi</body></html>"],
    ["text outside root", `hi${SVG_OK}`],
    ["two roots", SVG_OK + SVG_OK],
    ["trailing markup", SVG_OK + "<script>1</script>"],
    ["unclosed", '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'],
    ["mismatched", '<svg xmlns="http://www.w3.org/2000/svg"><g></path></svg>'],
    ["duplicate attr", svg('<path d="M0 0" d="M1 1"/>')],
    ["unquoted attr", svg("<path d=M0/>")],
    ["data- attr", svg('<path d="M0 0" data-x="1"/>')],
    ["NUL byte", svg('<path d="M0\u00000"/>')],
    ["text in svg", svg("hello")],
    ["unknown element", svg("<marquee/>")],
    [
      "too deep",
      `<svg xmlns="http://www.w3.org/2000/svg">${"<g>".repeat(200)}${"</g>".repeat(200)}</svg>`,
    ],
  ])("rejects %s", (_n, doc) => {
    expect(ok(doc)).toMatchObject({ ok: false });
  });
  it("rejects UTF-16 and invalid UTF-8 SVG", () => {
    const utf16 = new Uint8Array(SVG_OK.length * 2);
    for (let i = 0; i < SVG_OK.length; i++) utf16[i * 2] = SVG_OK.charCodeAt(i);
    expect(ok(utf16)).toMatchObject({ ok: false });
    expect(ok(bytes(SVG_OK, [0xff, 0xfe]))).toMatchObject({ ok: false });
  });
});

describe("readBodyLimited", () => {
  const streamOf = (n: number, chunk = 1024) => {
    let sent = 0;
    let pulls = 0;
    const s = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        if (sent >= n) return c.close();
        const k = Math.min(chunk, n - sent);
        sent += k;
        c.enqueue(new Uint8Array(k));
      },
    });
    return { s, pulls: () => pulls };
  };
  it("rejects on Content-Length alone, without reading the body", async () => {
    const { s, pulls } = streamOf(10 * 1024 * 1024);
    const req = new Request("http://localhost/x", {
      method: "POST",
      body: s,
      // @ts-expect-error duplex is required for streaming request bodies
      duplex: "half",
      headers: { "Content-Length": String(10 * 1024 * 1024) },
    });
    // The runtime may strip Content-Length; either way the limit holds.
    const r = await readBodyLimited(req, 1000);
    expect(r).toBeNull();
    expect(pulls()).toBeLessThan(20);
  });
  it("stops reading a chunked body past the limit", async () => {
    const { s, pulls } = streamOf(50 * 1024 * 1024);
    const req = new Request("http://localhost/x", {
      method: "POST",
      body: s,
      // @ts-expect-error duplex is required for streaming request bodies
      duplex: "half",
    });
    expect(await readBodyLimited(req, 4096)).toBeNull();
    expect(pulls()).toBeLessThan(20);
  });
  it("returns the bytes when within the limit", async () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });
    expect(await readBodyLimited(req, 10)).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("setup action: logo upload", () => {
  it("stores a valid PNG under a fixed key and records type + version", async () => {
    const r = await setupAction(upload(PNG), e);
    expect(r).toMatchObject({ intent: "logo", ok: true });
    expect(await r2Keys()).toEqual(["brand/logo-on-light"]);
    const v = await getLogoVersions(e);
    expect(v.onLight).toMatch(/^[0-9a-f]{16}$/);
    expect(v.onDark).toBeNull();
    expect(JSON.stringify(r)).not.toContain("brand/");
  });
  it("stores the dark variant independently", async () => {
    await setupAction(upload(WEBP, { variant: "on-dark" }), e);
    expect(await r2Keys()).toEqual(["brand/logo-on-dark"]);
    const v = await getLogoVersions(e);
    expect(v.onLight).toBeNull();
    expect(v.onDark).not.toBeNull();
  });
  it("replacing changes the version; same bytes keep it", async () => {
    await setupAction(upload(PNG), e);
    const a = (await getLogoVersions(e)).onLight;
    await setupAction(upload(PNG), e);
    expect((await getLogoVersions(e)).onLight).toBe(a);
    await setupAction(upload(JPEG, { name: "a.jpg", type: "image/jpeg" }), e);
    expect((await getLogoVersions(e)).onLight).not.toBe(a);
  });
  it("trusts the bytes, not the filename or the declared Content-Type", async () => {
    // Real PNG labelled as HTML: accepted and stored as image/png.
    await setupAction(upload(PNG, { name: "x.html", type: "text/html" }), e);
    const res = await serveLogo(
      new Request("http://localhost/brand/logo/on-light"),
      "on-light",
      e,
    );
    expect(res.headers.get("Content-Type")).toBe("image/png");
    // HTML labelled as PNG: refused, nothing changes.
    const r = await setupAction(
      upload(bytes("<script>alert(1)</script>"), {
        name: "x.png",
        type: "image/png",
      }),
      e,
    );
    expect(r.ok).toBe(false);
  });
  it.each([
    ["gif", GIF],
    ["empty", bytes()],
    ["svg with script", bytes(svg("<script>1</script>"))],
    ["png polyglot", bytes(PNG, "<svg onload=alert(1)>")],
  ])("refuses %s and writes nothing", async (_n, data) => {
    const r = await setupAction(upload(data), e);
    expect(r).toMatchObject({ intent: "logo", ok: false });
    expect(typeof r.error).toBe("string");
    expect(await r2Keys()).toEqual([]);
    expect((await getLogoVersions(e)).onLight).toBeNull();
  });
  it("a refused upload keeps the previous logo", async () => {
    await setupAction(upload(PNG), e);
    const v = (await getLogoVersions(e)).onLight;
    await setupAction(upload(GIF), e);
    expect((await getLogoVersions(e)).onLight).toBe(v);
  });
  it("refuses a file over 512 KB (declared and body size)", async () => {
    const big = bytes(svg(`<!-- ${"a".repeat(LOGO_MAX_BYTES)} -->`));
    const r = await setupAction(upload(big), e);
    expect(r).toMatchObject({ ok: false });
    expect(await r2Keys()).toEqual([]);
  });
  it("refuses a huge body without buffering it (Content-Length)", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(65536));
        if (pulled > 400) c.close();
      },
    });
    const req = new Request("http://localhost/admin/setup", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=zzz",
        "Content-Length": String(30 * 1024 * 1024),
      },
      body,
      // @ts-expect-error duplex is required for streaming request bodies
      duplex: "half",
    });
    const r = await setupAction(req, e);
    expect(r).toMatchObject({ ok: false });
    expect(pulled).toBeLessThan(40);
  });
  it("refuses an unknown variant, a missing file and a non-file field", async () => {
    expect(
      await setupAction(upload(PNG, { variant: "../../etc" }), e),
    ).toMatchObject({ ok: false });
    expect(
      await setupAction(upload(PNG, { variant: "thumb" }), e),
    ).toMatchObject({ ok: false });
    expect(
      await setupAction(multipart({ intent: "logo", variant: "on-light" }), e),
    ).toMatchObject({ ok: false });
    expect(
      await setupAction(
        multipart({ intent: "logo", variant: "on-light", file: "not a file" }),
        e,
      ),
    ).toMatchObject({ ok: false });
    expect(await r2Keys()).toEqual([]);
  });
  it("non-admin gets 401 and cross-site gets 403, before anything is read or stored", async () => {
    expect(await status(setupAction(upload(PNG), nonAdmin))).toBe(401);
    expect(
      await status(
        setupAction(upload(PNG, {}, { "Sec-Fetch-Site": "cross-site" }), e),
      ),
    ).toBe(403);
    expect(
      await status(
        setupAction(upload(PNG, {}, { Origin: "https://evil.example" }), e),
      ),
    ).toBe(403);
    expect(await r2Keys()).toEqual([]);
  });
  it("same-origin upload with Sec-Fetch-Site passes", async () => {
    const r = await setupAction(
      upload(PNG, {}, { "Sec-Fetch-Site": "same-origin" }),
      e,
    );
    expect(r.ok).toBe(true);
  });
});

describe("setup action: logoReset", () => {
  it("removes both logos, the R2 objects and the settings", async () => {
    await setupAction(upload(PNG), e);
    await setupAction(upload(WEBP, { variant: "on-dark" }), e);
    const r = await setupAction(multipart({ intent: "logoReset" }), e);
    expect(r).toMatchObject({ intent: "logoReset", ok: true });
    expect(await r2Keys()).toEqual([]);
    expect(await getLogoVersions(e)).toEqual({ onLight: null, onDark: null });
    const res = await serveLogo(
      new Request("http://localhost/brand/logo/on-light"),
      "on-light",
      e,
    );
    expect(res.status).toBe(404);
  });
  it("is admin-only and same-site only", async () => {
    await setupAction(upload(PNG), e);
    const req = (h: HeadersInit = {}) => multipart({ intent: "logoReset" }, h);
    expect(await status(setupAction(req(), nonAdmin))).toBe(401);
    expect(
      await status(setupAction(req({ "Sec-Fetch-Site": "cross-site" }), e)),
    ).toBe(403);
    expect((await getLogoVersions(e)).onLight).not.toBeNull();
  });
  it("works on a urlencoded form too", async () => {
    await setupAction(upload(PNG), e);
    const r = await setupAction(
      new Request("http://localhost/admin/setup", {
        method: "POST",
        body: new URLSearchParams({ intent: "logoReset" }),
      }),
      e,
    );
    expect(r.ok).toBe(true);
    expect((await getLogoVersions(e)).onLight).toBeNull();
  });
});

describe("GET /brand/logo/:variant", () => {
  const get = (variant: string, qs = "", env_: Env = e) =>
    serveLogo(
      new Request(`http://localhost/brand/logo/${variant}${qs}`),
      variant,
      env_,
    );
  it("serves the bytes with type from validation and hardened headers", async () => {
    await setupAction(upload(PNG), e);
    const v = (await getLogoVersions(e)).onLight!;
    const res = await get("on-light", `?v=${v}`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.get("Content-Disposition")).toBe("inline");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });
  it("a missing or wrong version is never cached as immutable", async () => {
    await setupAction(upload(PNG), e);
    for (const qs of ["", "?v=deadbeefdeadbeef", "?v=", "?v=%00"]) {
      const res = await get("on-light", qs);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).not.toMatch(/immutable/);
    }
  });
  it("serves an SVG as image/svg+xml with the sandbox CSP, even on direct navigation", async () => {
    await setupAction(
      upload(bytes(SVG_OK), { name: "l.svg", type: "image/svg+xml" }),
      e,
    );
    const res = await applySecurityHeaders(await get("on-light"), {
      nonce: "n",
      mock: false,
    });
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    // The route's own strict policy wins over the site-wide one.
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it("404 when nothing is configured (the bundled logo is the default)", async () => {
    expect((await get("on-light")).status).toBe(404);
    expect((await get("on-dark")).status).toBe(404);
  });
  it.each([
    "../brand/logo-on-light",
    "..%2fphotos",
    "on-light/..",
    "on-light%2f..%2fx",
    "ON-LIGHT",
    "on-light%00",
    "on-light ",
    "__proto__",
    "constructor",
    "thumb",
    "view-lg",
    "",
    "brand/logo-on-light",
    "%2e%2e",
  ])("does not read any R2 key for variant %j", async (variant) => {
    await env.CACHE.put("secret/object", "TOP SECRET");
    await env.CACHE.put("photos/abc/view-lg", "PHOTO");
    await setupAction(upload(PNG), e);
    const reads: string[] = [];
    const spy = {
      ...e,
      CACHE: new Proxy(e.CACHE, {
        get(t, p) {
          if (p === "get" || p === "head")
            return (k: string) => {
              reads.push(k);
              return (t as never as Record<string, (k: string) => unknown>)[
                p as string
              ](k);
            };
          const v = Reflect.get(t, p) as unknown;
          return typeof v === "function" ? v.bind(t) : v;
        },
      }),
    } as Env;
    const res = await get(variant, "", spy);
    expect(res.status).toBe(404);
    expect(reads).toEqual([]);
    expect(await res.text()).not.toContain("SECRET");
  });
  it("never serves a stored type outside the allow-list (tampered settings row)", async () => {
    await setupAction(upload(PNG), e);
    await putSetting(
      e,
      "logo_on_light",
      JSON.stringify({ t: "text/html", v: "0123456789abcdef" }),
    );
    expect((await get("on-light")).status).toBe(404);
    await putSetting(e, "logo_on_light", "not json");
    expect((await get("on-light")).status).toBe(404);
    await putSetting(
      e,
      "logo_on_light",
      JSON.stringify({ t: "image/png", v: "../x" }),
    );
    expect((await get("on-light")).status).toBe(404);
  });
  it("404 when the R2 object does not match the recorded version", async () => {
    await setupAction(upload(PNG), e);
    await env.CACHE.put("brand/logo-on-light", "<script>x</script>", {
      customMetadata: { v: "ffffffffffffffff" },
    });
    expect((await get("on-light")).status).toBe(404);
  });
  it("route loader is registered and returns the same", async () => {
    await setupAction(upload(PNG), e);
    const res = (await logoLoader({
      request: new Request("http://localhost/brand/logo/on-light"),
      params: { variant: "on-light" },
    } as never)) as Response;
    expect(res.status).toBe(200);
  });
});

describe("root loader exposes only versions", () => {
  it("includes logo versions (null by default) and no keys or metadata", async () => {
    const c = new RouterContextProvider();
    c.set(nonceContext, "n");
    const call = async () =>
      (await rootLoader({
        request: new Request("http://localhost/"),
        context: c,
      } as never)) as unknown as { data: { logo: unknown } };
    const before = await call();
    expect(before.data.logo).toEqual({ onLight: null, onDark: null });
    await setupAction(upload(PNG), e);
    const after = await call();
    const json = JSON.stringify(after.data.logo);
    expect(json).toMatch(/"onLight":"[0-9a-f]{16}"/);
    expect(json).not.toMatch(/brand\/|image\/|logo_on/);
    expect(await getSetting(e, "logo_on_light")).toBeTruthy();
  });
});

describe("validateLogo performance on hostile SVG", () => {
  it("rejects pathological 500 KB inputs quickly", () => {
    const t0 = Date.now();
    const many = `<svg xmlns="http://www.w3.org/2000/svg"><path ${' a="b"'.repeat(80000)}/></svg>`;
    const open = `<svg xmlns="http://www.w3.org/2000/svg"><g a="${"x".repeat(500000)}`;
    const nest = `<svg xmlns="http://www.w3.org/2000/svg">${"<g ".repeat(150000)}`;
    for (const s of [many, open, nest])
      expect(validateLogo(bytes(s.slice(0, LOGO_MAX_BYTES)))).toMatchObject({
        ok: false,
      });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
