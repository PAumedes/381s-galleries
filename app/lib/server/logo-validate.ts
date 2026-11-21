import { ascii, bad, LOGO_MAX_BYTES, sideOk } from "./logo-types";
import type { LogoCheck } from "./logo-types";
import { checkSvg } from "./logo-svg";

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
