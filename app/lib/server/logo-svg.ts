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

export function checkSvg(b: Uint8Array): LogoCheck {
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
