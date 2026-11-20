/* global fetch, WebSocket */
import process from "node:process";
import { setTimeout } from "node:timers";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { compile } from "tailwindcss";

const require = createRequire(import.meta.url);
const SRC = readFileSync("app/components/Lightbox.tsx", "utf8");
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

// The dialog root's touch utilities, taken from the real component.
const rootTouch = () =>
  [...SRC.matchAll(/className=\{`([^`]*)`\}/g)]
    .map((m) => m[1])
    .find((c) => c.includes("fixed inset-0"))
    .split(/\s+/)
    .filter((c) => c.startsWith("touch-"));

// Real Chrome, real touch events via CDP: does a downward swipe reach the page
// as pointer events (pointerup) or does the browser claim it (pointercancel)?
async function swipeDown(html) {
  const port = 9900 + Math.floor(Math.random() * 90);
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
      width: 412,
      height: 800,
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
    await sleep(800);
    const touch = (type, y) =>
      send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x: 200, y }],
      });
    await touch("touchStart", 200);
    for (let y = 200; y <= 420; y += 20) {
      await touch("touchMove", y);
      await sleep(16);
    }
    await touch("touchEnd", 420);
    await sleep(300);
    const r = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: "window.__log.join(',')",
    });
    return r.result.value.split(",");
  } finally {
    ch.kill();
  }
}

describe.skipIf(!HAS_CHROME)("T6.26 lightbox swipe down on real touch", () => {
  it("the dialog root's touch-action lets pointer events through (no pointercancel)", async () => {
    const touch = rootTouch();
    expect(touch.length).toBeGreaterThan(0);
    const style = await css(["fixed", "inset-0", ...touch]);
    const html = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>${style}</style><body style="margin:0;height:3000px"><div id=d class="fixed inset-0 ${touch.join(" ")}"></div><script>window.__log=[];for(const t of ["pointerdown","pointermove","pointerup","pointercancel"])d.addEventListener(t,()=>window.__log.push(t));</script>`;
    const log = await swipeDown(html);
    expect(log).toContain("pointerdown");
    expect(log).toContain("pointermove");
    expect(log).toContain("pointerup");
    expect(log).not.toContain("pointercancel");
  }, 30000);
});
