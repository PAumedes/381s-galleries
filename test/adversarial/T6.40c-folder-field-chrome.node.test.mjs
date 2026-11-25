/* global WebSocket, Request */
import { setTimeout } from "node:timers";
import { spawnSync } from "node:child_process";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from "react-router";
import { describe, expect, it } from "vitest";
import { ClientFolderField } from "../../app/components/admin/gallery-edit/ClientFolderField.tsx";
import { en } from "../../app/i18n/en.ts";
import { es } from "../../app/i18n/es.ts";
import { launchChrome } from "../support/chrome.mjs";
import { css } from "../support/tailwind-css.mjs";

const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clients = [
  { id: "a", name: "Acme", slug: "acme" },
  { id: "b", name: "Ñandú ".repeat(30), slug: "x".repeat(60), hasPin: true },
];

async function page(lang = "es") {
  const routes = [
    {
      id: "root",
      path: "/",
      loader: () => ({ lang, messages: lang === "es" ? es : en }),
      children: [
        {
          path: "admin",
          Component: () =>
            h(ClientFolderField, { g: { clientId: "b" }, clients }),
        },
      ],
    },
  ];
  const handler = createStaticHandler(routes);
  const ctx = await handler.query(new Request("http://x/admin"));
  const router = createStaticRouter(handler.dataRoutes, ctx);
  const inner = renderToString(
    h(StaticRouterProvider, { router, context: ctx, hydrate: false }),
  );
  const cls = [...inner.matchAll(/class="([^"]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean);
  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>${await css(cls)}</style><body data-admin style="margin:0;padding:16px">${inner}`;
}

async function run(html, width, expr, dir = "ltr") {
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
        expression:
          "document.readyState==='complete'&&!!document.querySelector('select')",
      });
      if (r?.result?.value) break;
      await sleep(50);
    }
    await send("Runtime.evaluate", {
      expression: `document.documentElement.dir='${dir}'`,
    });
    return (
      await send("Runtime.evaluate", { returnByValue: true, expression: expr })
    ).result.value;
  } finally {
    ch.kill();
  }
}

const MEASURE = `(() => {
  const sel = document.querySelector('select[name=clientId]');
  const r = sel.getBoundingClientRect();
  const n = document.querySelector('[role=note]');
  const nr = n && n.getBoundingClientRect();
  const wide = [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.right > innerWidth + 0.5 || b.left < -0.5; }).length;
  return { note: !!n, noteRight: nr && nr.right, noteLeft: nr && nr.left, noteClip: n && n.scrollWidth > n.clientWidth + 1, wide, h: r.height, right: r.right, fs: parseFloat(getComputedStyle(sel).fontSize), iw: innerWidth, over: document.documentElement.scrollWidth > innerWidth };
})()`;

describe.skipIf(!HAS_CHROME)(
  "T6.40c album-details client folder select in Chrome",
  () => {
    for (const w of [320, 360, 412]) {
      it(`${w}px: select is 48px tall, 16px text, inside the viewport`, async () => {
        const m = await run(await page(), w, MEASURE);
        expect(m.h).toBeGreaterThanOrEqual(47.5);
        expect(m.fs).toBeGreaterThanOrEqual(16);
        expect(m.right).toBeLessThanOrEqual(m.iw);
        expect(m.over).toBe(false);
      }, 60000);
    }

    for (const lang of ["es", "en"])
      for (const dir of ["ltr", "rtl"])
        for (const w of [320, 360, 412]) {
          it(`${lang} ${w}px ${dir}: the client-PIN warning is visible, wraps and stays inside the viewport`, async () => {
            const m = await run(await page(lang), w, MEASURE, dir);
            expect(m.note).toBe(true);
            expect(m.noteLeft).toBeGreaterThanOrEqual(0);
            expect(m.noteRight).toBeLessThanOrEqual(m.iw);
            expect(m.noteClip).toBe(false);
            expect(m.wide).toBe(0);
            expect(m.over).toBe(false);
          }, 60000);
        }
  },
);
