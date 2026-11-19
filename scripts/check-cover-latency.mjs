/* global document, getComputedStyle, requestAnimationFrame, window */
// Cover-preview latency check (Portada tab, "2. Así se ve", Móvil frame).
// Not part of `pnpm test`: needs a running dev server (`pnpm dev`, mock Drive,
// ALLOW_DEV_ADMIN=1, `pnpm seed`) and Playwright with a Chromium.
//
//   node scripts/check-cover-latency.mjs [--base http://localhost:5173]
//        [--latency 2000] [--action-latency 400] [--first-ms 200] [--verbose]
//        [--shots DIR] [--allow-remote]
//
// What it does: opens the Portada tab, switches to the mobile cover and picks
// a photo for it, while every image request (`/admin/img/*`, `/img/*`) takes
// `--latency` ms (a cold Drive fetch) and the save itself (`POST`, `.data`)
// takes `--action-latency` ms. A frame sampler records, per animation frame,
// what the Móvil preview frame paints. It fails unless
//   1. the chosen photo (its thumbnail, already loaded in the chooser, or the
//      big image) is painted within ~200 ms of the click;
//   2. the old cover is never painted after that (no flash of the old image);
//   3. the final, larger image replaces the placeholder (within latency);
//   4. the frame's box never changes size (no layout shift);
//   5. choosing a photo that was loaded before shows its final image within
//      500 ms (the browser may reuse it: versioned, privately cacheable URL).
// The image handler models the server's header policy: `private, immutable`
// when the URL carries `?v=` (what the app emits for admin images), else
// `private, no-store`. Local hosts only (like check-admin-mobile.mjs).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", process.env.BASE_URL ?? "http://localhost:5173");
const LATENCY = Number(arg("latency", "2000"));
const ACTION_LATENCY = Number(arg("action-latency", "400"));
const SHOTS = arg("shots", "");
const VERBOSE = process.argv.includes("--verbose");
const FIRST_MS = Number(arg("first-ms", "200"));
const WARM_MS = 500;
{
  let host = "";
  try {
    host = new URL(BASE).hostname;
  } catch {
    /* invalid URL: refused below */
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (!local && !process.argv.includes("--allow-remote")) {
    console.error(
      `Refusing non-local --base ${BASE} (pass --allow-remote to override).`,
    );
    process.exit(2);
  }
}

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

const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const svg = (id, variant) => {
  const [w, h] = variant === "thumb" ? [300, 200] : [1200, 800];
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='${w}' height='${h}' fill='hsl(${hue(id)},55%,45%)'/><text x='20' y='${h / 2}' font-size='${h / 8}' fill='#fff'>${variant} ${id.slice(0, 6)}</text></svg>`;
};

const chromium = await loadChromium();
const browser = await chromium
  .launch({ channel: "chrome", args: ["--disable-dev-shm-usage"] })
  .catch(() => chromium.launch());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- gallery with several photos --------------------------------------------
const probe = await browser.newPage();
await probe.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
const galleries = await probe.$$eval('a[href^="/admin/g/"]', (as) => [
  ...new Set(as.map((a) => a.getAttribute("href").split("/")[3])),
]);
await probe.close();
if (!galleries.length) {
  console.error(
    "No galleries at /admin. Is the dev server running and seeded?",
  );
  process.exit(2);
}

const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const stats = { image: 0, imageUrls: [] };
await ctx.route(
  /\/(admin\/)?img\/|picsum\.photos|fastly\.picsum/,
  async (route) => {
    const u = new URL(route.request().url());
    const m = u.pathname.match(/\/img\/([^/]+)\/([^/]+)$/);
    stats.image++;
    stats.imageUrls.push(u.pathname + u.search);
    await sleep(LATENCY);
    await route
      .fulfill({
        status: 200,
        contentType: "image/svg+xml",
        headers: {
          "Cache-Control": u.searchParams.has("v")
            ? "private, max-age=31536000, immutable"
            : "private, no-store",
        },
        body: svg(m ? m[1] : "x", m ? m[2] : "view-sm"),
      })
      .catch(() => {});
  },
);
// The save (React Router POST / .data revalidation) is slow too.
await ctx.route(
  (url) => url.origin === new URL(BASE).origin && !/\/img\//.test(url.pathname),
  async (route) => {
    const req = route.request();
    if (
      ACTION_LATENCY > 0 &&
      (req.method() === "POST" || req.url().includes(".data"))
    )
      await sleep(ACTION_LATENCY);
    await route.fallback().catch(() => {});
  },
);
const page = await ctx.newPage();

let gid = "";
for (const id of galleries) {
  await page.goto(`${BASE}/admin/g/${id}?tab=fotos`, {
    waitUntil: "networkidle",
  });
  const n = await page.locator('img[src^="/admin/img/"]').count();
  if (n >= 8) {
    gid = id;
    break;
  }
}
if (!gid) {
  console.error("Need a gallery with at least 8 photos (pnpm seed).");
  process.exit(2);
}
const post = async (fields) =>
  (
    await ctx.request.post(`${BASE}/admin/g/${gid}`, {
      form: fields,
      headers: { Origin: BASE, "Sec-Fetch-Site": "same-origin" },
    })
  ).status();
// Start from "automatic desktop cover, no mobile cover".
await post({ intent: "cover", photoId: "", device: "mobile" });
await post({ intent: "cover", photoId: "" });

// ---- the scenario ---------------------------------------------------------------
await page.goto(`${BASE}/admin/g/${gid}?tab=portada`, {
  waitUntil: "networkidle",
});
// Click until the page (hydrated) has switched to the mobile cover.
const toMobile = page.getByRole("button", {
  name: "Portada móvil",
  exact: true,
});
for (let i = 0; i < 20; i++) {
  await toMobile.click();
  if ((await toMobile.getAttribute("aria-pressed")) === "true") break;
  await sleep(250);
}
const frame = page.locator(
  '[data-testid="live-preview"] [data-frame="mobile"]',
);
await frame.waitFor();
// The chooser's thumbnails are lazy: wait until the first ones have loaded.
const choosers = page.locator('button[aria-label^="Usar "]');
await choosers
  .nth(5)
  .locator("img")
  .evaluate((img) =>
    img.complete && img.naturalWidth > 0
      ? true
      : new Promise((r) => img.addEventListener("load", () => r(true))),
  );
const idOf = async (n) => {
  const src = await choosers.nth(n).locator("img").getAttribute("src");
  return decodeURIComponent(src.split("/")[3]);
};
const oldId = (
  await frame.locator("img[data-cover-img]").first().getAttribute("src")
).split("/")[3];

await page.evaluate(() => {
  const samples = [];
  const w = window;
  w.__cover = { samples, click: null };
  document.addEventListener(
    "click",
    () => {
      if (w.__cover.click === null) w.__cover.click = performance.now();
    },
    true,
  );
  const frame = document.querySelector(
    '[data-testid="live-preview"] [data-frame="mobile"]',
  );
  const tick = () => {
    const f = document.querySelector(
      '[data-testid="live-preview"] [data-frame="mobile"]',
    );
    const box = (f ?? frame).getBoundingClientRect();
    const imgs = [
      ...(f ?? frame).querySelectorAll(
        "img[data-cover-img], img[data-placeholder]",
      ),
    ].map((img) => {
      const s = getComputedStyle(img);
      return {
        src: img.getAttribute("src"),
        painted:
          img.complete &&
          img.naturalWidth > 0 &&
          Number(s.opacity) > 0.01 &&
          s.visibility !== "hidden",
      };
    });
    samples.push({
      t: performance.now(),
      w: Math.round(box.width),
      h: Math.round(box.height),
      imgs,
    });
    requestAnimationFrame(tick);
  };
  tick();
});
// Pick a photo (not the old cover) whose thumbnail is already loaded.
const pickA = 3;
const pickB = 4;
const idA = await idOf(pickA);
const idB = await idOf(pickB);

async function choose(n, id, label) {
  await page.evaluate(() => {
    window.__cover.click = null;
    window.__cover.samples.length = 0;
  });
  // The chooser (a <details>) may have closed on the remount; its thumbnail
  // must be loaded, as it is for the owner who is looking at it.
  const det = page.locator("details.group\\/choose");
  if (!(await det.evaluate((d) => d.open)))
    await det.locator("summary").click();
  await choosers.nth(n).scrollIntoViewIfNeeded();
  await choosers
    .nth(n)
    .locator("img")
    .evaluate((img) =>
      img.complete && img.naturalWidth > 0
        ? true
        : new Promise((r) => img.addEventListener("load", () => r(true))),
    );
  await page.evaluate(() => {
    window.__cover.click = null;
    window.__cover.samples.length = 0;
  });
  const clickedAt = Date.now();
  await choosers.nth(n).click();
  const finalSeen = () =>
    page.evaluate(
      ([id]) =>
        window.__cover.samples.some((s) =>
          s.imgs.some(
            (i) =>
              i.painted &&
              i.src.includes(`/${id}/view-sm`) &&
              s.t > window.__cover.click,
          ),
        ),
      [id],
    );
  const deadline = Date.now() + LATENCY + ACTION_LATENCY + 4000;
  while (!(await finalSeen()) && Date.now() < deadline) await sleep(50);
  await sleep(150);
  const { samples, click } = await page.evaluate(() => window.__cover);
  if (VERBOSE)
    for (const [t, u] of stats.imageUrls.filter(([t]) => t >= clickedAt))
      console.log(
        `    request +${t - clickedAt} ms ${u.replace(/[0-9a-f-]{36}/, (m) => m.slice(0, 6))}`,
      );
  const after = samples.filter((s) => s.t >= click);
  const rel = (s) => Math.round(s.t - click);
  const paints = (s, id) =>
    s.imgs.some((i) => i.painted && i.src.includes(`/${id}/`));
  const first = after.find((s) => paints(s, id));
  const final = after.find((s) =>
    s.imgs.some((i) => i.painted && i.src.includes(`/${id}/view-sm`)),
  );
  const other = (s) =>
    s.imgs.some((i) => i.painted && !i.src.includes(`/${id}/`));
  const oldAfterFirst = first
    ? after.filter((s) => s.t > first.t && other(s))
    : [];
  const staleMs = first
    ? Math.round(first.t - click)
    : Math.round((after.at(-1)?.t ?? click) - click);
  const blank = after.filter((s) => !s.imgs.some((i) => i.painted));
  const sizes = new Set(after.map((s) => `${s.w}x${s.h}`));
  // Timeline: one line per change of what is painted.
  let last = "";
  console.log(`  timeline (${label}), ms after click:`);
  for (const s of after) {
    const key = s.imgs
      .filter((i) => i.painted)
      .map((i) => i.src.replace("/admin/img/", "").replace(/\?.*/, ""))
      .map((x) =>
        x
          .replace(oldId, "OLD")
          .replace(id, "NEW")
          .replace(/[0-9a-f-]{36}/, "other"),
      )
      .join(" + ");
    if (key !== last) {
      console.log(
        `    ${String(rel(s)).padStart(5)}  ${key || "(nothing painted)"}`,
      );
      last = key;
    }
  }
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${label}.png` });
  }
  return {
    firstMs: first ? rel(first) : null,
    finalMs: final ? rel(final) : null,
    oldAfterFirst: oldAfterFirst.length,
    blankMs: blank.length ? rel(blank.at(-1)) - rel(blank[0]) : 0,
    sizes: [...sizes],
    staleMs,
  };
}

let failures = 0;
const check = (ok, msg) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};

console.log(
  `gallery ${gid.slice(0, 8)}, image latency ${LATENCY} ms, save latency ${ACTION_LATENCY} ms, old cover ${oldId.slice(0, 8)}`,
);
console.log("A. cold: choose a mobile cover");
const a = await choose(pickA, idA, "cold");
check(
  a.firstMs !== null && a.firstMs <= FIRST_MS,
  `chosen photo painted within ${FIRST_MS} ms of the click (got ${a.firstMs ?? "never"} ms)`,
);
check(
  a.oldAfterFirst === 0,
  `old cover never painted after the chosen photo appears (${a.oldAfterFirst} frames)`,
);
check(
  a.finalMs !== null && a.finalMs <= LATENCY + ACTION_LATENCY + 1500,
  `final larger image painted (${a.finalMs ?? "never"} ms)`,
);
check(a.sizes.length === 1, `frame size never changes (${a.sizes.join(", ")})`);

console.log("B. cold: choose another photo, then warm: back to the first");
await choose(pickB, idB, "cold-2");
const c = await choose(pickA, idA, "warm");
check(
  c.finalMs !== null && c.finalMs <= WARM_MS,
  `re-choosing a loaded photo shows its final image within ${WARM_MS} ms (got ${c.finalMs ?? "never"} ms)`,
);
check(
  c.oldAfterFirst === 0,
  `no flash of the previous cover on the warm switch (${c.oldAfterFirst} frames)`,
);

console.log(`image requests that reached the network: ${stats.image}`);
await browser.close();
if (failures) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nall checks passed");
