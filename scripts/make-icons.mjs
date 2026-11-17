// Manual one-off: renders the studio mark (public/brand/logo-black.svg) onto
// white PNG icons for the PWA manifest. Run `node scripts/make-icons.mjs` and
// commit the output. Never runs at build or request time.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const root = new URL("../public/", import.meta.url);
const logo = readFileSync(new URL("brand/logo-black.svg", root), "utf8");
const inner = logo.slice(logo.indexOf(">") + 1, logo.lastIndexOf("</svg>"));
const [, , vbW, vbH] = /viewBox="([\d.\s-]+)"/
  .exec(logo)[1]
  .split(/\s+/)
  .map(Number);

// markHeight = fraction of the canvas the mark occupies (maskable keeps the
// whole mark inside the 80% safe circle: ~20% padding on every side).
const ICONS = [
  { file: "icon-192.png", size: 192, markHeight: 0.7 },
  { file: "icon-512.png", size: 512, markHeight: 0.7 },
  { file: "maskable-512.png", size: 512, markHeight: 0.6 },
];

mkdirSync(new URL("icons/", root), { recursive: true });
for (const { file, size, markHeight } of ICONS) {
  const h = size * markHeight;
  const w = (h * vbW) / vbH;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" fill="#fff"/>` +
    `<svg x="${(size - w) / 2}" y="${(size - h) / 2}" width="${w}" height="${h}" viewBox="0 0 ${vbW} ${vbH}">${inner}</svg></svg>`;
  const png = new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng();
  writeFileSync(new URL(`icons/${file}`, root), png);
  console.log(file, png.length);
}
