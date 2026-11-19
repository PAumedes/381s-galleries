// Build-time asset generator (never runs at request time, no app code uses
// it): writes a NEUTRAL icon set (rounded square with a generic camera-aperture
// glyph) into `brand-neutral/` by default, or into the directory given as the
// first argument: `node scripts/make-icons.mjs [outDir]`. It never touches
// public/ unless you point it there, so the served icons stay as they are.
// Forks replace the files in public/ with their own (docs/SELF-HOSTING.md).
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = process.argv[2]
  ? pathToFileURL(path.resolve(process.argv[2]) + path.sep)
  : new URL("../brand-neutral/", import.meta.url);
const BG = "#1a1a1a";
const FG = "#fafaf8";

/** Six aperture blades around a ring, on a 100x100 canvas. */
function glyph() {
  const blades = Array.from({ length: 6 }, (_, i) => {
    const a = (i * 60 * Math.PI) / 180;
    const x = 50 + 16 * Math.cos(a);
    const y = 50 + 16 * Math.sin(a);
    const x2 = 50 + 30 * Math.cos(a + 1.05);
    const y2 = 50 + 30 * Math.sin(a + 1.05);
    return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }).join("");
  return `<g fill="none" stroke="${FG}" stroke-width="4" stroke-linecap="round"><circle cx="50" cy="50" r="30"/>${blades}</g>`;
}

/** `scale` = share of the canvas the glyph spans; `radius` rounds the square. */
function icon(size, { scale, radius }) {
  const k = (size * scale) / 100;
  const off = (size - 100 * k) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${radius * size}" fill="${BG}"/>` +
    `<g transform="translate(${off} ${off}) scale(${k})">${glyph()}</g></svg>`
  );
}
const png = (svg) =>
  new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng();

/** ICO container holding one PNG image (Vista+ format). */
function ico(pngBuf, size) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head[6] = size;
  head[7] = size;
  head.writeUInt16LE(1, 10);
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(pngBuf.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, pngBuf]);
}

mkdirSync(new URL("icons/", root), { recursive: true });
const out = (file, data) => {
  writeFileSync(new URL(file, root), data);
  console.log(file, data.length);
};
out("icons/icon-192.png", png(icon(192, { scale: 0.7, radius: 0.18 })));
out("icons/icon-512.png", png(icon(512, { scale: 0.7, radius: 0.18 })));
// Maskable: full-bleed background, glyph inside the 80% safe circle.
out("icons/maskable-512.png", png(icon(512, { scale: 0.55, radius: 0 })));
out("apple-touch-icon.png", png(icon(180, { scale: 0.7, radius: 0 })));
out("favicon.ico", ico(png(icon(32, { scale: 0.8, radius: 0.18 })), 32));
out("favicon.svg", Buffer.from(icon(64, { scale: 0.8, radius: 0.18 })));
