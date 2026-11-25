/* global WebSocket */
// Loads an HTML string in real Chrome at a mobile width and evaluates an expression.
import { setTimeout } from "node:timers";
import { launchChrome } from "./chrome.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function evalInChrome(html, width, expr, ready = "true") {
  const { ch, list } = await launchChrome();
  try {
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
      height: 900,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send("Page.enable");
    await send("Page.navigate", {
      url: "data:text/html;charset=utf-8," + encodeURIComponent(html),
    });
    for (let i = 0; i < 200; i++) {
      const r = await send("Runtime.evaluate", {
        returnByValue: true,
        expression: `document.readyState==='complete'&&(${ready})`,
      });
      if (r?.result?.value) break;
      await sleep(50);
    }
    return (
      await send("Runtime.evaluate", { returnByValue: true, expression: expr })
    ).result.value;
  } finally {
    ch.kill();
  }
}
