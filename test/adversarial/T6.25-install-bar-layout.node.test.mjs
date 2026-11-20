/* global fetch, WebSocket */
import process from "node:process";
import { setTimeout } from "node:timers";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { compile } from "tailwindcss";

const require = createRequire(import.meta.url);
const SRC = readFileSync("app/components/AddToHomeHint.tsx", "utf8");
const EN = readFileSync("app/i18n/en.public.ts", "utf8");
const str = (k) => new RegExp(`"${k}": "([^"]*)"`).exec(EN)[1];

const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

async function css(candidates) {
  const app = readFileSync("app/app.css", "utf8").replace(
    /@import "@fontsource[^;]*;/,
    "",
  );
  const c = await compile(app, {
    base: process.cwd() + "/app",
    loadStylesheet: async (id, base) => {
      const path = id === "tailwindcss" ? "tailwindcss/index.css" : id;
      const file = path.startsWith(".")
        ? require.resolve(path, { paths: [base] })
        : require.resolve(path, { paths: [process.cwd()] });
      return { path: file, base, content: readFileSync(file, "utf8") };
    },
  });
  return c.build(candidates);
}

// Real Chrome with touch emulation (pointer: coarse), via CDP.
async function measure(html, width, height) {
  const port = 9600 + Math.floor(Math.random() * 300);
  const ch = spawn(
    "google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let list;
    for (let i = 0; i < 50 && !list; i++) {
      try {
        list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      } catch {
        await sleep(200);
      }
    }
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
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
    await send("Page.enable");
    await send("Page.navigate", {
      url: "data:text/html;charset=utf-8," + encodeURIComponent(html),
    });
    await sleep(1000);
    const r = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => { const b = document.querySelector('[role=status]').getBoundingClientRect(); const p = document.querySelector('[role=status] p'); return {barH: b.height, pW: p.getBoundingClientRect().width, overflow: p.scrollWidth > p.clientWidth + 1, coarse: matchMedia('(pointer: coarse)').matches}; })()`,
    });
    return r.result.value;
  } finally {
    ch.kill();
  }
}

async function page() {
  const classes = [...SRC.matchAll(/className="([^"]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean);
  const bar =
    /role="status"[\s\S]*?className="([^"]*)"/.exec(SRC)?.[1] ??
    SRC.match(/className="(bg-ink[^"]*)"/)[1];
  const p = /<p className="([^"]*)">\s*\{t\("pwa.androidText"\)\}/.exec(SRC)[1];
  const btn = /onClick=\{accept\}\s*className="([^"]*)"/.exec(SRC)[1];
  const dis = /aria-label=\{t\("pwa.dismiss"\)\}\s*className="([^"]*)"/.exec(
    SRC,
  )[1];
  const style = await css(classes);
  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>${style}</style><body style="margin:0"><div role=status class="${bar}"><p class="${p}">${str("pwa.androidText")}</p><button class="${btn}">${str("pwa.install")}</button><button class="${dis}"><svg width=24 height=24 class="size-6"></svg></button></div>`;
}

describe.skipIf(!HAS_CHROME)(
  "T6.25 Android install bar on narrow phones",
  () => {
    for (const w of [320, 360]) {
      it(`${w}px: message keeps a readable column (>=120px) and the bar stays under 25% of a 640px viewport`, async () => {
        const m = await measure(await page(), w, 640);
        expect(m.coarse).toBe(true);
        expect(m.pW).toBeGreaterThanOrEqual(120);
        expect(m.barH).toBeLessThanOrEqual(160);
        expect(m.overflow).toBe(false);
      }, 30000);
    }
  },
);
