/* global WebSocket */
import { setTimeout } from "node:timers";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { launchChrome } from "../support/chrome.mjs";
import { classesOf, css, sourcesOf } from "../support/tailwind-css.mjs";

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

const BAR = readFileSync(
  "app/components/admin/AdminGalleryPreview.tsx",
  "utf8",
);
const ES = readFileSync("app/i18n/es.admin.ts", "utf8");
const str = (k) => new RegExp(`"${k}": "([^"]*)"`).exec(ES)[1];

const MEASURE = `(() => {
  const b = document.getElementById('bar'); if (!b) return null;
  const p = b.querySelector('p'), a = b.querySelector('a');
  const r = document.createRange(); r.selectNodeContents(p);
  const lines = [...r.getClientRects()].filter((x) => x.width > 0);
  const tl = Math.min(...lines.map((x) => x.left)), tr = Math.max(...lines.map((x) => x.right));
  const ab = a.getBoundingClientRect(), bb = b.getBoundingClientRect();
  return { vw: innerWidth, textCx: (tl + tr) / 2, btnCx: (ab.left + ab.right) / 2,
    btnW: ab.width, btnH: ab.height, barW: bb.width, barH: bb.height,
    textBottom: p.getBoundingClientRect().bottom, btnTop: ab.top, btnLeft: ab.left,
    textRight: p.getBoundingClientRect().right,
    overflow: document.documentElement.scrollWidth > innerWidth,
    textFont: parseFloat(getComputedStyle(p).fontSize) };
})()`;

describe.skipIf(!HAS_CHROME)("T6.42 'Vista previa' bar layout", () => {
  async function measure(w) {
    const bar = /data-admin-preview-bar=""\s*className="([^"]*)"/.exec(BAR)[1];
    const p = /<p className="([^"]*)">/.exec(BAR)[1];
    const a = /<a\s+href=\{[^]*?className="([^"]*)"/.exec(BAR)[1];
    const style = await css(classesOf(sourcesOf("app/components")));
    const html = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>${style}</style><body style="margin:0"><div id=bar class="${bar}"><p class="${p}">${str("admin.preview.bar")} \u00b7 Borrador \u00b7 Con PIN \u00b7 Prueba</p><a href="#" class="${a}">${str("admin.preview.back")}</a></div>`;
    const { ch, ev } = await session(
      "data:text/html;charset=utf-8," + encodeURIComponent(html),
      w,
    );
    try {
      return await until(() => ev(MEASURE), "the bar");
    } finally {
      ch.kill();
    }
  }

  for (const w of [320, 360, 412]) {
    it(`${w}px: centered text above one full-width 48px button, no overflow`, async () => {
      const m = await measure(w);
      expect(m.overflow).toBe(false);
      expect(Math.abs(m.textCx - m.vw / 2)).toBeLessThanOrEqual(2);
      expect(Math.abs(m.btnCx - m.vw / 2)).toBeLessThanOrEqual(2);
      expect(m.btnTop).toBeGreaterThanOrEqual(m.textBottom);
      expect(m.btnH).toBeGreaterThanOrEqual(48);
      expect(m.btnW).toBeGreaterThanOrEqual(m.barW - 40);
      expect(m.textFont).toBeGreaterThanOrEqual(16);
    }, 60000);
  }

  it("desktop 1024px: unchanged, one row with the button on the right", async () => {
    const m = await measure(1024);
    expect(m.btnTop).toBeLessThan(m.textBottom);
    expect(m.btnLeft).toBeGreaterThan(m.textRight);
    expect(m.barH).toBeLessThan(90);
  }, 60000);
});
