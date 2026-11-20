/* global WebSocket */
import process from "node:process";
import { setTimeout } from "node:timers";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { launchChrome } from "../support/chrome.mjs";
import { classesOf, css } from "../support/tailwind-css.mjs";

const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, what, tries = 100) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function buildPage() {
  const dir = mkdtempSync(join(tmpdir(), "focal-"));
  const out = join(dir, "bundle.js");
  const r = spawnSync(
    "node_modules/.bin/esbuild",
    [
      "test/support/focal-drag-entry.tsx",
      "--bundle",
      "--jsx=automatic",
      "--format=iife",
      '--define:process.env.NODE_ENV="production"',
      `--outfile=${out}`,
      "--log-level=error",
    ],
    { encoding: "utf8", cwd: process.cwd() },
  );
  if (r.status !== 0) throw new Error(r.stderr);
  const srcs = [
    "app/components/admin/CoverPreview.tsx",
    "app/components/admin/LivePreview.tsx",
    "app/components/CoverHero.tsx",
  ].map((f) => readFileSync(f, "utf8"));
  const style = await css(classesOf(srcs));
  const file = join(dir, "page.html");
  writeFileSync(
    file,
    `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>${style}</style><body style="margin:0"><div id=root></div><script>${readFileSync(out, "utf8").replace(/<\/script/g, "<\\/script")}</script>`,
  );
  return "file://" + file;
}

async function session(url, width = 412) {
  const { ch, list } = await launchChrome();
  const ws = new WebSocket(
    list.find((t) => t.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pend = {};
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend[m.id]) pend[m.id](m.result);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      pend[++id] = r;
      ws.send(JSON.stringify({ id, method, params }));
    });
  const ev = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true }))
      ?.result?.value;
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 915,
    deviceScaleFactor: 2.6,
    mobile: true,
  });
  await send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  await send("Page.enable");
  await send("Page.navigate", { url });
  return { ch, send, ev };
}

describe.skipIf(!HAS_CHROME)(
  "T6.35 focal point: drag with a finger at 412px",
  () => {
    it("the marker follows the finger, the page does not scroll, release saves", async () => {
      const { ch, send, ev } = await session(await buildPage());
      try {
        await until(
          () => ev("!!document.querySelector('[data-testid=focus-picker]')"),
          "the picker",
        );
        await ev(
          "document.querySelector('[data-testid=focus-picker]').scrollIntoView({block:'center'})",
        );
        const rect = await until(async () => {
          const r = await ev(
            "(() => { const r = document.querySelector('[data-testid=focus-picker]').getBoundingClientRect(); return r.width > 50 ? {l:r.left,t:r.top,w:r.width,h:r.height} : null })()",
          );
          return r;
        }, "the picker box");
        expect(rect.t).toBeGreaterThan(0);
        expect(rect.t + rect.h).toBeLessThan(915);
        const scrollBefore = await ev("window.scrollY");
        const at = (fx, fy) => ({
          x: rect.l + rect.w * fx,
          y: rect.t + rect.h * fy,
        });
        const touch = (type, p) =>
          send("Input.dispatchTouchEvent", {
            type,
            touchPoints: p ? [{ ...p, id: 1 }] : [],
          });
        const marker = () =>
          ev(
            "(() => { const m = document.querySelector('[data-testid=focus-marker]'); return m.style.left + ',' + m.style.top })()",
          );

        await touch("touchStart", at(0.25, 0.25));
        await until(async () => (await marker()) === "25%,25%", "tap point");
        // A mostly vertical drag: the browser would scroll the page.
        for (let i = 1; i <= 8; i++)
          await touch("touchMove", at(0.25 + 0.05 * i, 0.25 + 0.06 * i));
        await until(
          async () => (await marker()) === "65%,73%",
          "marker following the finger",
        );
        expect(await ev("window.scrollY")).toBe(scrollBefore);
        expect(await ev("window.__saved === undefined")).toBe(true);
        await touch("touchEnd");
        const saved = await until(
          () => ev("window.__saved ?? null"),
          "the focus save on release",
        );
        expect(saved).toMatchObject({
          intent: "focus",
          device: "desktop",
          focusX: "65",
          focusY: "73",
        });
        expect(await ev("window.scrollY")).toBe(scrollBefore);
      } finally {
        ch.kill();
      }
    }, 60000);
  },
);

const BAR = readFileSync(
  "app/components/admin/AdminGalleryPreview.tsx",
  "utf8",
);
const ES = readFileSync("app/i18n/es.admin.ts", "utf8");
const str = (k) => new RegExp(`"${k}": "([^"]*)"`).exec(ES)[1];

describe.skipIf(!HAS_CHROME)("T6.35 'Vista previa' bar on phones", () => {
  for (const w of [360, 412]) {
    it(`${w}px: 16px text, 48px button, wraps without overflow`, async () => {
      const bar = /data-admin-preview-bar=""\s*className="([^"]*)"/.exec(
        BAR,
      )[1];
      const p = /<p className="([^"]*)">/.exec(BAR)[1];
      const a = /<a\s+href=\{[^]*?className="([^"]*)"/.exec(BAR)[1];
      const style = await css(classesOf([BAR]));
      const html = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>${style}</style><body style="margin:0"><div id=bar class="${bar}"><p class="${p}">${str("admin.preview.bar")} · Borrador · Con PIN · Prueba</p><a href="#" class="${a}">${str("admin.preview.back")}</a></div>`;
      const { ch, ev } = await session(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
        w,
      );
      try {
        const m = await until(
          () =>
            ev(
              `(() => { const b = document.getElementById('bar'); if (!b) return null; const a = b.querySelector('a').getBoundingClientRect(); const p = b.querySelector('p'); return { font: parseFloat(getComputedStyle(p).fontSize), linkFont: parseFloat(getComputedStyle(b.querySelector('a')).fontSize), linkH: a.height, linkW: a.width, barH: b.getBoundingClientRect().height, pW: p.getBoundingClientRect().width, overflow: document.documentElement.scrollWidth > innerWidth, position: getComputedStyle(b).position } })()`,
            ),
          "the bar",
        );
        expect(m.font).toBeGreaterThanOrEqual(16);
        expect(m.linkFont).toBeGreaterThanOrEqual(16);
        expect(m.linkH).toBeGreaterThanOrEqual(48);
        expect(m.linkW).toBeGreaterThanOrEqual(48);
        expect(m.overflow).toBe(false);
        expect(m.pW).toBeGreaterThanOrEqual(150);
        expect(m.barH).toBeLessThanOrEqual(200);
        expect(m.position).toBe("static");
      } finally {
        ch.kill();
      }
    }, 60000);
  }
});
