import { bad } from "./logo-types";
import type { LogoCheck } from "./logo-types";

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

/** Scanner state for {@link checkSvg}; every `scan*` step returns false on anything unsafe. */
interface Scan {
  text: string;
  i: number;
  stack: string[];
  elements: number;
  rootClosed: boolean;
  sawRoot: boolean;
  rootNs: boolean;
}

/** Character data up to the next tag: only whitespace, or text inside a text element. */
function scanText(s: Scan): boolean {
  const next = s.text.indexOf("<", s.i);
  const chunk = s.text.slice(s.i, next < 0 ? s.text.length : next);
  if (/&/.test(chunk)) return false;
  if (/[^ \t\r\n]/.test(chunk)) {
    const top = s.stack[s.stack.length - 1];
    if (!top || !TEXT_ELEMENTS.has(top)) return false;
    if (top === "style" && !safeCss(chunk)) return false;
    if (SCHEMES.test(chunk) && top === "style") return false;
  }
  s.i = next < 0 ? s.text.length : next;
  return true;
}

function scanComment(s: Scan): boolean {
  const end = s.text.indexOf("-->", s.i + 4);
  if (end < 0) return false;
  const body = s.text.slice(s.i + 4, end);
  if (body.includes("--") || body.endsWith("-")) return false;
  s.i = end + 3;
  return true;
}

/** The attributes of one start tag: allow-listed, unique, bounded, namespace only on the root. */
function scanAttrs(s: Scan, name: string, attrText: string): boolean {
  const seen = new Set<string>();
  for (const m of attrText.matchAll(ATTR)) {
    const attr = m[1];
    const value = m[2] ?? m[3] ?? "";
    if (seen.has(attr) || seen.size >= MAX_ATTRS) return false;
    seen.add(attr);
    if (!SVG_ATTRS.has(attr) || !safeAttr(attr, value)) return false;
    if (attr.startsWith("xmlns") && s.sawRoot) return false;
    if (attr === "type" && name !== "style") return false;
    if (attr === "xmlns" && !s.sawRoot) s.rootNs = true;
  }
  return true;
}

function scanOpenTag(s: Scan): boolean {
  OPEN_TAG.lastIndex = s.i;
  const open = OPEN_TAG.exec(s.text);
  if (!open) return false;
  const [, name, attrText, selfClose] = open;
  if (!SVG_ELEMENTS.has(name) || s.rootClosed) return false;
  if (!s.sawRoot && name !== "svg") return false;
  if (++s.elements > MAX_ELEMENTS || s.stack.length >= MAX_DEPTH) return false;
  if (!scanAttrs(s, name, attrText)) return false;
  if (!s.sawRoot && !s.rootNs) return false; // the SVG namespace is required
  s.sawRoot = true;
  s.i = OPEN_TAG.lastIndex;
  if (selfClose) {
    if (s.stack.length === 0) s.rootClosed = true;
  } else s.stack.push(name);
  return true;
}

/** One markup token at `s.i`: comment, end tag or start tag. */
function scanMarkup(s: Scan): boolean {
  if (s.text.startsWith("<!--", s.i)) return scanComment(s);
  CLOSE_TAG.lastIndex = s.i;
  const close = CLOSE_TAG.exec(s.text);
  if (!close) return scanOpenTag(s);
  if (s.stack.pop() !== close[1]) return false;
  if (s.stack.length === 0) s.rootClosed = true;
  s.i = CLOSE_TAG.lastIndex;
  return true;
}

export function checkSvg(b: Uint8Array): LogoCheck {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return bad("svg_unsafe");
  }
  const unsafe = bad("svg_unsafe");
  if (CONTROL.test(text)) return unsafe;
  const s: Scan = {
    text,
    i: 0,
    stack: [],
    elements: 0,
    rootClosed: false,
    sawRoot: false,
    rootNs: false,
  };
  XML_DECL.lastIndex = 0;
  if (text.startsWith("<?xml")) {
    if (!XML_DECL.test(text)) return unsafe;
    s.i = XML_DECL.lastIndex;
  }
  while (s.i < text.length) {
    if (!(text[s.i] !== "<" ? scanText(s) : scanMarkup(s))) return unsafe;
  }
  return s.sawRoot && s.rootClosed && s.stack.length === 0
    ? { ok: true, type: "image/svg+xml" }
    : unsafe;
}
