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
import { ClientPage } from "../../app/components/ClientPage.tsx";
import { es } from "../../app/i18n/es.ts";
import { launchChrome } from "../support/chrome.mjs";
import { css } from "../support/tailwind-css.mjs";

const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const long = "Ñandú ".repeat(30);
const cover = { id: "p1", v: "abc", focus: null, aspect: 1.5 };
const items = [
  {
    slug: "boda",
    clientSlug: "acme",
    title: "Boda Ana",
    eventDate: "2026-03-14",
    cover,
  },
  {
    slug: "x".repeat(60),
    clientSlug: "acme",
    title: "x".repeat(200),
    eventDate: null,
    cover,
  },
  {
    slug: "pin",
    clientSlug: "acme",
    title: long,
    eventDate: "2026-01-01",
    cover: null,
    locked: true,
  },
  {
    slug: "rtl",
    clientSlug: "acme",
    title: "مرحبا بالعالم ".repeat(8) + "👩‍👩‍👧‍👦",
    eventDate: null,
    cover,
  },
];
const page = {
  state: "client",
  clientSlug: "acme",
  clientName: "Cliente " + long + "A".repeat(80),
  items,
};

async function html() {
  const routes = [
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "es", messages: es, studioName: "Estudio" }),
      children: [{ path: "acme", Component: () => h(ClientPage, { page }) }],
    },
  ];
  const handler = createStaticHandler(routes);
  const ctx = await handler.query(new Request("http://x/acme"));
  const router = createStaticRouter(handler.dataRoutes, ctx);
  const inner = renderToString(
    h(StaticRouterProvider, { router, context: ctx, hydrate: false }),
  );
  const cls = [...inner.matchAll(/class="([^"]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean);
  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>${await css(cls)}</style><body style="margin:0">${inner}`;
}

async function run(html, width, expr) {
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
          "document.readyState==='complete'&&!!document.querySelector('main a')",
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

const MEASURE = `(() => {
  const r = (e) => e.getBoundingClientRect();
  const tiles = [...document.querySelectorAll('main li a')].map((a) => ({
    h: r(a).height, left: r(a).left, right: r(a).right,
    lock: !!a.querySelector('svg'),
    img: !!a.querySelector('img'),
    text: a.scrollWidth > a.clientWidth + 1,
  }));
  const h1 = document.querySelector('h1');
  return {
    tiles,
    h1: { left: r(h1).left, right: r(h1).right },
    docOverflow: document.documentElement.scrollWidth > innerWidth,
    iw: innerWidth,
    links: [...document.querySelectorAll('footer a, footer button')].map((e) => r(e).height),
  };
})()`;

describe.skipIf(!HAS_CHROME)("T6.40e client homepage in Chrome", () => {
  for (const w of [320, 360, 412]) {
    it(`${w}px: tiles are tap-sized and inside the viewport, no horizontal scroll`, async () => {
      const m = await run(await html(), w, MEASURE);
      expect(m.docOverflow).toBe(false);
      expect(m.tiles.length).toBe(4);
      for (const t of m.tiles) {
        expect(t.h).toBeGreaterThanOrEqual(48);
        expect(t.left).toBeGreaterThanOrEqual(0);
        expect(t.right).toBeLessThanOrEqual(m.iw);
        expect(t.text).toBe(false);
      }
      expect(m.tiles.filter((t) => t.lock).length).toBe(1);
      expect(m.tiles.filter((t) => t.img).length).toBe(3);
      expect(m.h1.left).toBeGreaterThanOrEqual(0);
      expect(m.h1.right).toBeLessThanOrEqual(m.iw);
    }, 60000);
  }
});
