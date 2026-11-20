/* global fetch, WebSocket */
// Launches headless Chrome for the real-browser tests (CDP).
//
// Each launch gets its own profile AND lets Chrome pick a free debugging port
// (port 0, then read it from DevToolsActivePort). Tests run in parallel and
// several of them start many Chromes: random fixed ports collided, so one
// test could talk to another test's browser or never find its own.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchChrome() {
  const dir = mkdtempSync(join(tmpdir(), "chrome-"));
  const ch = spawn(
    "google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--remote-debugging-port=0",
      `--user-data-dir=${dir}`,
      "--no-first-run",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const file = join(dir, "DevToolsActivePort");
  for (let i = 0; i < 300; i++) {
    if (existsSync(file)) {
      const port = Number(readFileSync(file, "utf8").split("\n")[0]);
      if (port) {
        try {
          const list = await (
            await fetch(`http://127.0.0.1:${port}/json`)
          ).json();
          return { ch, port, list };
        } catch {
          // Port written but not serving yet: keep polling.
        }
      }
    }
    await sleep(100);
  }
  ch.kill();
  throw new Error("Chrome did not open its debugging port in 30 s");
}

/** Polls `fn` until it returns a truthy value (no fixed sleeps). */
export async function until(fn, what = "condition", tries = 100) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Minimal CDP client for the first page target of a `launchChrome()` result. */
export async function connectCdp(list) {
  const ws = new WebSocket(
    list.find((t) => t.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = {};
  const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) pending[m.id](m.result);
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      pending[++id] = r;
      ws.send(JSON.stringify({ id, method, params }));
    });
  /** Evaluates an expression in the page and returns its JSON value. */
  const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true }))
      ?.result?.value;
  return { send, evaluate, events, close: () => ws.close() };
}
