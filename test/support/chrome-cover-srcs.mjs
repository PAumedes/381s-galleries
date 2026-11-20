/* global fetch, WebSocket, console */
// usage: node chrome-cover-srcs.mjs <html-file> <width>
// Prints (JSON) the currentSrc of every `img[data-cover-img]` that headless
// Chrome (mobile emulation, CDP) picks for that page at that viewport width.
import process from "node:process";
import { setTimeout } from "node:timers";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [file, w] = process.argv.slice(2);
const html = readFileSync(file, "utf8");
const port = 9900 + Math.floor(Math.random() * 90);
const ch = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    // Own profile per launch: parallel Chromes sharing the default one fight
    // over its lock and the later one never opens its debugging port.
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "chrome-"))}`,
    "--no-first-run",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let list;
  for (let i = 0; i < 150 && !list; i++) {
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
    width: Number(w),
    height: 900,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await send("Page.enable");
  await send("Page.navigate", {
    url: "data:text/html;charset=utf-8," + encodeURIComponent(html),
  });
  // Poll instead of a fixed sleep: on a loaded runner the browser picks the
  // <picture> source a bit later, and currentSrc is "" until it has.
  const read = () =>
    send("Runtime.evaluate", {
      returnByValue: true,
      expression: `[...document.querySelectorAll('img[data-cover-img]')].map(i => i.currentSrc)`,
    });
  let r = await read();
  for (
    let i = 0;
    i < 100 &&
    !(r.result.value.length > 0 && r.result.value.every((s) => s !== ""));
    i++
  ) {
    await sleep(100);
    r = await read();
  }
  console.log(JSON.stringify(r.result.value));
} finally {
  ch.kill();
  process.exit(0);
}
