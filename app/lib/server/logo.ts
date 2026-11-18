import { inArray } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { deleteSetting, putSetting, SETTINGS_KEYS } from "./settings";

/** Largest accepted logo file (also the cap for a setup form body, plus overhead). */
export const LOGO_MAX_BYTES = 512 * 1024;
/** Multipart framing and the other form fields on top of the file itself. */
const FORM_OVERHEAD_BYTES = 16 * 1024;
export const SETUP_BODY_MAX_BYTES = LOGO_MAX_BYTES + FORM_OVERHEAD_BYTES;

export const LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

export const LOGO_VARIANTS = ["on-light", "on-dark"] as const;
export type LogoVariant = (typeof LOGO_VARIANTS)[number];

/**
 * Fixed R2 key prefixes and settings rows per variant. The object key is
 * `<prefix>-<v>` where `v` is the server-computed content hash: nothing in a
 * key comes from user input.
 */
const SLOTS: Record<LogoVariant, { r2Prefix: string; setting: string }> = {
  "on-light": {
    r2Prefix: "brand/logo-on-light",
    setting: SETTINGS_KEYS.logoOnLight,
  },
  "on-dark": {
    r2Prefix: "brand/logo-on-dark",
    setting: SETTINGS_KEYS.logoOnDark,
  },
};
const r2KeyOf = (variant: LogoVariant, v: string) =>
  `${SLOTS[variant].r2Prefix}-${v}`;
/** Largest accepted raster side, in pixels (decode-bomb guard). */
const MAX_SIDE = 4096;
const sideOk = (w: number, h: number) =>
  w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE;

export const isLogoVariant = (v: unknown): v is LogoVariant =>
  typeof v === "string" && (LOGO_VARIANTS as readonly string[]).includes(v);

export type LogoError =
  "empty" | "too_large" | "unsupported" | "corrupt" | "svg_unsafe";
export type LogoCheck =
  { ok: true; type: LogoType } | { ok: false; error: LogoError };

const bad = (error: LogoError): LogoCheck => ({ ok: false, error });
const ascii = (b: Uint8Array, at: number, s: string) =>
  b.length >= at + s.length &&
  [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
const u32be = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u32le = (b: Uint8Array, at: number) =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Walks every PNG chunk: IHDR first, IEND last, nothing after it. */
function checkPng(b: Uint8Array): LogoCheck {
  let pos = 8;
  let first = true;
  let idat = false;
  let idatDone = false;
  while (pos + 12 <= b.length) {
    const len = u32be(b, pos);
    const type = String.fromCharCode(...b.slice(pos + 4, pos + 8));
    if (!/^[A-Za-z]{4}$/.test(type)) return bad("corrupt");
    const end = pos + 12 + len;
    if (end > b.length) return bad("corrupt");
    if (first) {
      if (type !== "IHDR" || len !== 13) return bad("corrupt");
      const w = u32be(b, pos + 8);
      const h = u32be(b, pos + 12);
      if (!sideOk(w, h)) return bad("corrupt");
      first = false;
    } else if (type === "IHDR") return bad("corrupt");
    if (type === "IDAT") {
      if (idatDone) return bad("corrupt"); // IDAT chunks must be consecutive
      idat = true;
    } else if (idat) idatDone = true;
    if (type === "IEND")
      return len === 0 && end === b.length && idat
        ? { ok: true, type: "image/png" }
        : bad("corrupt");
    pos = end;
  }
  return bad("corrupt");
}

const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** Walks the marker segments from SOI to a final EOI; no stray bytes anywhere. */
function checkJpeg(b: Uint8Array): LogoCheck {
  const corrupt = bad("corrupt");
  let pos = 2;
  while (pos < b.length) {
    if (b[pos] !== 0xff) return corrupt;
    while (b[pos] === 0xff) pos++; // fill bytes
    const m = b[pos++];
    if (m === 0xd9)
      return pos === b.length ? { ok: true, type: "image/jpeg" } : corrupt;
    if (m === 0x00 || m === 0x01 || (m >= 0xd0 && m <= 0xd8)) continue;
    if (pos + 2 > b.length) return corrupt;
    const len = (b[pos] << 8) | b[pos + 1];
    if (len < 2 || pos + len > b.length) return corrupt;
    if (JPEG_SOF.has(m)) {
      if (len < 8) return corrupt;
      const h = (b[pos + 3] << 8) | b[pos + 4];
      const w = (b[pos + 5] << 8) | b[pos + 6];
      if (!sideOk(w, h)) return corrupt;
    }
    pos += len;
    if (m === 0xda) {
      // entropy-coded data: runs until a marker that is not a stuffed 0xFF00 or RSTn
      while (pos < b.length) {
        const n = b[pos + 1];
        if (b[pos] === 0xff && n !== 0x00 && !(n >= 0xd0 && n <= 0xd7)) break;
        pos++;
      }
    }
  }
  return corrupt;
}

function webpSize(b: Uint8Array): [number, number] | null {
  if (ascii(b, 12, "VP8X") && b.length >= 30)
    return [
      (b[24] | (b[25] << 8) | (b[26] << 16)) + 1,
      (b[27] | (b[28] << 8) | (b[29] << 16)) + 1,
    ];
  if (ascii(b, 12, "VP8L") && b.length >= 25 && b[20] === 0x2f) {
    const bits = u32le(b, 21);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  if (ascii(b, 12, "VP8 ") && b.length >= 30 && b[23] === 0x9d)
    return [(b[26] | (b[27] << 8)) & 0x3fff, (b[28] | (b[29] << 8)) & 0x3fff];
  return null;
}

function checkWebp(b: Uint8Array): LogoCheck {
  if (b.length < 20 || u32le(b, 4) !== b.length - 8) return bad("corrupt");
  const size = webpSize(b);
  return size && sideOk(size[0], size[1])
    ? { ok: true, type: "image/webp" }
    : bad("corrupt");
}

// ---- SVG: reject anything that is not trivially safe (no rewriting) ----

const SVG_ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "title",
  "desc",
  "style",
  "text",
  "tspan",
  "symbol",
]);
const TEXT_ELEMENTS = new Set(["title", "desc", "style", "text", "tspan"]);
const SVG_ATTRS = new Set([
  "id",
  "class",
  "style",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "width",
  "height",
  "viewBox",
  "preserveAspectRatio",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "transform",
  "points",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "clip-path",
  "clip-rule",
  "mask",
  "clipPathUnits",
  "maskUnits",
  "maskContentUnits",
  "version",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "letter-spacing",
  "dx",
  "dy",
  "display",
  "visibility",
  "xml:space",
  "role",
  "href",
  "xlink:href",
  "xmlns",
  "xmlns:xlink",
  "type",
]);
const ATTR_PATTERNS: Record<string, RegExp> = {
  id: /^[\w.-]{1,64}$/,
  class: /^[\w\s.-]{0,200}$/,
  d: /^[0-9A-Za-z\s.,+-]*$/,
  points: /^[0-9\s.,eE+-]*$/,
  transform: /^[\w\s.,()+-]*$/,
  gradientTransform: /^[\w\s.,()+-]*$/,
  href: /^#[A-Za-z_][\w.-]{0,63}$/,
  "xlink:href": /^#[A-Za-z_][\w.-]{0,63}$/,
  xmlns: /^http:\/\/www\.w3\.org\/2000\/svg$/,
  "xmlns:xlink": /^http:\/\/www\.w3\.org\/1999\/xlink$/,
  type: /^text\/css$/,
};
const MAX_ELEMENTS = 5000;
const MAX_DEPTH = 32;
const MAX_ATTRS = 40;

const OPEN_TAG =
  /<([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*)\s*(\/?)>/y;
const CLOSE_TAG = /<\/([A-Za-z][A-Za-z0-9]*)\s*>/y;
const XML_DECL =
  /<\?xml\s+version\s*=\s*"1\.[01]"(?:\s+encoding\s*=\s*"(?:UTF-8|utf-8)")?(?:\s+standalone\s*=\s*"(?:yes|no)")?\s*\?>/y;
const ATTR = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/;
const SCHEMES = /(?:java|vb)script:|data:/i;

/** CSS / paint values: no escapes, at-rules, entities or any url() but `url(#id)`. */
function safeCss(v: string): boolean {
  if (/[@\\&<]|expression|behavior|binding|import/i.test(v)) return false;
  // CSS functions that fetch a URL without a url() token.
  if (/(?:image-set|cross-fade|src|element|paint)\s*\(/i.test(v)) return false;
  return !/url\s*\(/i.test(v.replace(/url\(\s*#[\w.-]+\s*\)/gi, ""));
}

function safeAttr(name: string, value: string): boolean {
  if (CONTROL.test(value) || /[&<]/.test(value) || SCHEMES.test(value))
    return false;
  const pattern = ATTR_PATTERNS[name];
  if (pattern && !pattern.test(value)) return false;
  return safeCss(value);
}

function checkSvg(b: Uint8Array): LogoCheck {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return bad("svg_unsafe");
  }
  if (CONTROL.test(text)) return bad("svg_unsafe");
  const unsafe = bad("svg_unsafe");
  const stack: string[] = [];
  let i = 0;
  let elements = 0;
  let rootClosed = false;
  let sawRoot = false;
  let rootNs = false;
  XML_DECL.lastIndex = 0;
  if (text.startsWith("<?xml")) {
    if (!XML_DECL.test(text)) return unsafe;
    i = XML_DECL.lastIndex;
  }
  while (i < text.length) {
    if (text[i] !== "<") {
      const next = text.indexOf("<", i);
      const chunk = text.slice(i, next < 0 ? text.length : next);
      if (/&/.test(chunk)) return unsafe;
      if (/[^ \t\r\n]/.test(chunk)) {
        const top = stack[stack.length - 1];
        if (!top || !TEXT_ELEMENTS.has(top)) return unsafe;
        if (top === "style" && !safeCss(chunk)) return unsafe;
        if (SCHEMES.test(chunk) && top === "style") return unsafe;
      }
      i = next < 0 ? text.length : next;
      continue;
    }
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end < 0) return unsafe;
      const body = text.slice(i + 4, end);
      if (body.includes("--") || body.endsWith("-")) return unsafe;
      i = end + 3;
      continue;
    }
    CLOSE_TAG.lastIndex = i;
    const close = CLOSE_TAG.exec(text);
    if (close) {
      if (stack.pop() !== close[1]) return unsafe;
      if (stack.length === 0) rootClosed = true;
      i = CLOSE_TAG.lastIndex;
      continue;
    }
    OPEN_TAG.lastIndex = i;
    const open = OPEN_TAG.exec(text);
    if (!open) return unsafe;
    const [, name, attrText, selfClose] = open;
    if (!SVG_ELEMENTS.has(name) || rootClosed) return unsafe;
    if (!sawRoot && name !== "svg") return unsafe;
    if (++elements > MAX_ELEMENTS || stack.length >= MAX_DEPTH) return unsafe;
    const seen = new Set<string>();
    for (const m of attrText.matchAll(ATTR)) {
      const attr = m[1];
      const value = m[2] ?? m[3] ?? "";
      if (seen.has(attr) || seen.size >= MAX_ATTRS) return unsafe;
      seen.add(attr);
      if (!SVG_ATTRS.has(attr) || !safeAttr(attr, value)) return unsafe;
      if (attr.startsWith("xmlns") && sawRoot) return unsafe;
      if (attr === "type" && name !== "style") return unsafe;
      if (attr === "xmlns" && !sawRoot) rootNs = true;
    }
    if (!sawRoot && !rootNs) return unsafe; // the SVG namespace is required
    sawRoot = true;
    i = OPEN_TAG.lastIndex;
    if (selfClose) {
      if (stack.length === 0) rootClosed = true;
    } else stack.push(name);
  }
  return sawRoot && rootClosed && stack.length === 0
    ? { ok: true, type: "image/svg+xml" }
    : unsafe;
}

/** Decides the type from the bytes only (never the filename or Content-Type). */
export function validateLogo(b: Uint8Array): LogoCheck {
  if (b.length === 0) return bad("empty");
  if (b.length > LOGO_MAX_BYTES) return bad("too_large");
  if (PNG_SIG.every((v, i) => b[i] === v)) return checkPng(b);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return checkJpeg(b);
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return checkWebp(b);
  // SVG text: the first non-space byte is "<" (an optional BOM aside).
  const start = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  if (
    /^[ \t\r\n]*<(?:\?xml|!--|svg)/.test(
      new TextDecoder().decode(b.slice(start, start + 64)),
    )
  ) {
    return checkSvg(b.slice(start));
  }
  return bad("unsupported");
}

/**
 * Reads a request body but gives up (null) as soon as it exceeds `max`:
 * Content-Length is checked first, then the stream is counted chunk by chunk.
 */
export async function readBodyLimited(
  request: Request,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > max) {
    await request.body?.cancel().catch(() => {});
    return null;
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

// ---- storage (R2 object `<prefix>-<v>` + settings row `{t: type, v: version}`) ----

interface LogoMeta {
  t: LogoType;
  v: string;
}
const VERSION_RE = /^[0-9a-f]{16}$/;

function parseMeta(raw: string | undefined): LogoMeta | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Partial<LogoMeta> | null;
    if (
      m &&
      typeof m.t === "string" &&
      (LOGO_TYPES as readonly string[]).includes(m.t) &&
      typeof m.v === "string" &&
      VERSION_RE.test(m.v)
    )
      return { t: m.t as LogoType, v: m.v };
  } catch {
    /* corrupt row: treated as "no custom logo" */
  }
  return null;
}

async function readMetas(
  env: Pick<Env, "DB">,
): Promise<Record<LogoVariant, LogoMeta | null>> {
  const out: Record<LogoVariant, LogoMeta | null> = {
    "on-light": null,
    "on-dark": null,
  };
  try {
    const rows = await getDb(env as Env)
      .select()
      .from(schema.settings)
      .where(
        inArray(
          schema.settings.key,
          LOGO_VARIANTS.map((v) => SLOTS[v].setting),
        ),
      );
    for (const v of LOGO_VARIANTS)
      out[v] = parseMeta(rows.find((r) => r.key === SLOTS[v].setting)?.value);
  } catch {
    /* DB trouble: fall back to the bundled logo */
  }
  return out;
}

/** Public, non-secret cache-busting versions (null = the bundled logo). */
export async function getLogoVersions(
  env: Pick<Env, "DB">,
): Promise<{ onLight: string | null; onDark: string | null }> {
  const m = await readMetas(env);
  return { onLight: m["on-light"]?.v ?? null, onDark: m["on-dark"]?.v ?? null };
}

async function versionOf(b: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", b));
  return [...d.slice(0, 8)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Validates, then stores. Objects are versioned (`<prefix>-<v>`), so a new
 * upload never overwrites the one the pointer names: put the object, write the
 * pointer (the commit point), then drop the old object best-effort.
 */
export async function saveLogo(
  env: Pick<Env, "DB" | "CACHE">,
  variant: LogoVariant,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<LogoCheck> {
  const check = validateLogo(bytes);
  if (!check.ok) return check;
  const v = await versionOf(bytes);
  const key = r2KeyOf(variant, v);
  await env.CACHE.put(key, bytes, {
    httpMetadata: { contentType: check.type },
    customMetadata: { v },
  });
  const previous = (await readMetas(env))[variant];
  try {
    await putSetting(
      env,
      SLOTS[variant].setting,
      JSON.stringify({ t: check.type, v }),
    );
  } catch (err) {
    // Not committed: the old pointer and its object are untouched.
    if (previous?.v !== v) await env.CACHE.delete(key).catch(() => {});
    throw err;
  }
  if (previous && previous.v !== v)
    await env.CACHE.delete(r2KeyOf(variant, previous.v)).catch(() => {});
  return check;
}

/** Back to the bundled logos: clears the pointers first, then the objects. */
export async function resetLogos(
  env: Pick<Env, "DB" | "CACHE">,
): Promise<void> {
  const metas = await readMetas(env);
  for (const variant of LOGO_VARIANTS)
    await deleteSetting(env, SLOTS[variant].setting);
  for (const variant of LOGO_VARIANTS) {
    const m = metas[variant];
    if (m) await env.CACHE.delete(r2KeyOf(variant, m.v)).catch(() => {});
  }
}

/** Public resource: GET /brand/logo/:variant?v=<version>. */
export async function serveLogo(
  request: Request,
  variant: string | undefined,
  env: Pick<Env, "DB" | "CACHE">,
): Promise<Response> {
  const notFound = () =>
    new Response("Not found", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  if (!isLogoVariant(variant)) return notFound();
  const meta = (await readMetas(env))[variant];
  if (!meta) return notFound();
  const obj = await env.CACHE.get(r2KeyOf(variant, meta.v));
  if (!obj || obj.customMetadata?.v !== meta.v) return notFound();
  const asked = new URL(request.url).searchParams.get("v");
  return new Response(obj.body, {
    headers: {
      "Content-Type": meta.t,
      "Content-Length": String(obj.size),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      // Even opened directly, an SVG here can not run script or load anything.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control":
        asked === meta.v
          ? "public, max-age=31536000, immutable"
          : "public, max-age=0, must-revalidate",
    },
  });
}
