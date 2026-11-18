/* global document, innerWidth, innerHeight, getComputedStyle */
// Visual/layout check of every admin screen at phone, tablet and desktop widths.
// Not part of `pnpm test`: needs a running dev server (`pnpm dev`, mock Drive,
// ALLOW_DEV_ADMIN=1, `pnpm seed`) and Playwright with a Chromium.
//
//   node scripts/check-admin-mobile.mjs [--base http://localhost:5173] [--shots DIR] [--allow-remote]
//
// Screens: the list, every editor panel (?tab=), activity, favorites, card,
// setup. (The admin "Vista previa" page is the public gallery itself.)
// Per screen and width it fails on: horizontal overflow, visible controls
// smaller than 44x44 CSS px (phone width only), form fields under 16px font
// (iOS zooms them), and dialogs that do not fit the viewport. Pass --shots to
// also save PNGs ("<screen>-<width>.png"). Photos are faked locally (the mock
// Drive serves picsum URLs that may be unreachable).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", process.env.BASE_URL ?? "http://localhost:5173");
const ALLOW_REMOTE = process.argv.includes("--allow-remote");
{
  let host = "";
  try {
    host = new URL(BASE).hostname;
  } catch {
    /* invalid URL: refused below */
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (!local && !ALLOW_REMOTE) {
    console.error(
      `Refusing non-local --base ${BASE} (pass --allow-remote to override).`,
    );
    process.exit(2);
  }
}
const SHOTS = arg("shots", "");
const WIDTHS = [360, 768, 1280];
const HEIGHTS = { 360: 740, 768: 1024, 1280: 800 };
const MIN_TAP = 44;

async function loadChromium() {
  const require = createRequire(import.meta.url);
  for (const id of ["playwright", "playwright-core", "@playwright/test"]) {
    try {
      return require(id).chromium;
    } catch {
      /* try the next one */
    }
  }
  try {
    const root = (await import("node:child_process"))
      .execSync("npm root -g", { encoding: "utf8" })
      .trim();
    return createRequire(`${root}/`)("playwright").chromium;
  } catch {
    console.error(
      "Playwright not found: `npm i -g playwright` (and `playwright install chromium`).",
    );
    process.exit(2);
  }
}

const PNG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'><rect width='600' height='400' fill='#9aa'/><circle cx='300' cy='200' r='90' fill='#678'/></svg>";

/** Runs inside the page: returns a list of problems. */
function audit({ minTap, phone }) {
  const problems = [];
  const de = document.documentElement;
  if (de.scrollWidth > innerWidth)
    problems.push(
      `horizontal overflow: scrollWidth ${de.scrollWidth} > ${innerWidth}`,
    );
  const name = (el) =>
    `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 30)}"`;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.visibility !== "hidden" &&
      s.display !== "none"
    );
  };
  const sel =
    "a[href], button, select, textarea, input:not([type=hidden]), summary, [role=button], [role=tab]";
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el)) continue;
    // Inert content (the editor's scaled-down live preview) is not interactive.
    if (el.closest("[inert]")) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.left < -1) {
      if (!el.closest("[data-scroll-x]"))
        problems.push(
          `off-screen: ${name(el)} (${Math.round(r.left)}..${Math.round(r.right)})`,
        );
    }
    if (el.tagName === "INPUT" && /checkbox|radio/.test(el.type)) {
      // Native boxes are small: the tap area is their <label>.
      const b = (el.labels?.[0] ?? el).getBoundingClientRect();
      if (phone && b.height < minTap - 0.5)
        problems.push(
          `tap target ${Math.round(b.width)}x${Math.round(b.height)}: ${name(el)}`,
        );
      continue;
    }
    if (phone) {
      // Inline links inside running text are exempt (WCAG inline exception).
      const inline = el.tagName === "A" && s.display === "inline";
      if (!inline && (r.height < minTap - 0.5 || r.width < minTap - 0.5))
        problems.push(
          `tap target ${Math.round(r.width)}x${Math.round(r.height)}: ${name(el)}`,
        );
      if (
        /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) &&
        parseFloat(s.fontSize) < 16
      )
        problems.push(`font ${s.fontSize} < 16px (iOS zoom): ${name(el)}`);
    }
  }
  for (const d of document.querySelectorAll("dialog[open], [role=dialog]")) {
    if (!visible(d)) continue;
    const r = d.getBoundingClientRect();
    if (
      r.left < -1 ||
      r.right > innerWidth + 1 ||
      r.top < -1 ||
      r.bottom > innerHeight + 1
    )
      problems.push(`dialog does not fit viewport: ${name(d)}`);
  }
  return problems;
}

const chromium = await loadChromium();
const browser = await chromium
  .launch({ channel: "chrome" })
  .catch(() => chromium.launch());

// Discover galleries from the list (the dev server must be seeded).
const probe = await browser.newPage();
await probe.goto(`${BASE}/admin`);
const ids = await probe.$$eval('a[href^="/admin/g/"]', (as) => [
  ...new Set(as.map((a) => a.getAttribute("href").split("/")[3])),
]);
await probe.close();
if (!ids.length) {
  console.error(
    "No galleries found at /admin. Is the dev server running and seeded (pnpm seed)?",
  );
  process.exit(2);
}
const g = ids[0];
const SCREENS = [
  ["list", "/admin"],
  ["list-filtered", "/admin?estado=archivadas"],
  ["list-empty-search", "/admin?q=zzzzzz-no-match"],
  ["editor", `/admin/g/${g}`],
  ["editor-fotos", `/admin/g/${g}?tab=fotos`],
  ["editor-portada", `/admin/g/${g}?tab=portada`],
  ["editor-diseno", `/admin/g/${g}?tab=diseno`],
  ["editor-compartir", `/admin/g/${g}?tab=compartir`],
  ["activity", `/admin/g/${g}/activity`],
  ["favorites", `/admin/g/${g}/favorites`],
  ["card", `/admin/g/${g}/card`],
  ["setup", "/admin/setup"],
  ["not-found", "/admin/g/00000000-0000-0000-0000-000000000000"],
];

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failures = 0;
for (const width of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] },
    hasTouch: width < 768,
    isMobile: width < 768,
  });
  await ctx.route(/\/img\/|picsum\.photos|fastly\.picsum/, (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: PNG }),
  );
  const page = await ctx.newPage();
  for (const [name, path] of SCREENS) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const problems = await page.evaluate(audit, {
      minTap: MIN_TAP,
      phone: width < 768,
    });
    if (SHOTS)
      await page.screenshot({
        path: `${SHOTS}/${name}-${width}.png`,
        fullPage: true,
      });
    for (const p of problems) {
      failures++;
      console.log(`FAIL ${name} @${width}: ${p}`);
    }
    if (!problems.length) console.log(`ok   ${name} @${width}`);
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} problem(s)` : "\nall clear");
process.exit(failures ? 1 : 0);
