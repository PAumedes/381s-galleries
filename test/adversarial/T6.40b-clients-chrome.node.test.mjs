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
import { ClientList } from "../../app/components/admin/clients/ClientList.tsx";
import { ClientEditView } from "../../app/components/admin/clients/ClientEditView.tsx";
import { es } from "../../app/i18n/es.ts";
import { launchChrome } from "../support/chrome.mjs";
import { css } from "../support/tailwind-css.mjs";

const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const long = "Ñandú ".repeat(30);
const clients = [
  { id: "a", name: "Acme", slug: "acme", pageEnabled: true, albumCount: 1 },
  {
    id: "b",
    name: long,
    slug: "x".repeat(60),
    pageEnabled: false,
    albumCount: 12345,
  },
  {
    id: "c",
    name: "مرحبا بالعالم ".repeat(6) + "👩‍👩‍👧‍👦🎉",
    slug: "rtl",
    pageEnabled: true,
    albumCount: 0,
  },
];
const client = {
  id: "a",
  name: long,
  slug: "x".repeat(60),
  pageEnabled: true,
  defaultMode: "proofing",
  defaultShowOnHome: true,
};
const albums = [
  {
    id: "g1",
    title: long,
    slug: "y".repeat(60),
    status: "published",
    mode: "proofing",
  },
  { id: "g2", title: "Boda", slug: "boda", status: "draft", mode: "delivery" },
];

async function page(which) {
  const Component = () =>
    which === "list"
      ? h(ClientList, {
          clients,
          message: "Cliente eliminado.",
          actionData: undefined,
        })
      : h(ClientEditView, {
          client,
          albums,
          publicPage: { visible: 1, reason: null },
          actionData: undefined,
        });
  const routes = [
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "es", messages: es }),
      children: [{ path: "admin/clients", Component }],
    },
  ];
  const handler = createStaticHandler(routes);
  const ctx = await handler.query(new Request("http://x/admin/clients"));
  const router = createStaticRouter(handler.dataRoutes, ctx);
  const inner = renderToString(
    h(StaticRouterProvider, { router, context: ctx, hydrate: false }),
  );
  const cls = [...inner.matchAll(/class="([^"]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean);
  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>${await css(cls)}</style><body data-admin style="margin:0;padding:16px">${inner}`;
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
      mobile: width < 768,
    });
    await send("Page.enable");
    await send("Page.navigate", {
      url: "data:text/html;charset=utf-8," + encodeURIComponent(html),
    });
    for (let i = 0; i < 200; i++) {
      const r = await send("Runtime.evaluate", {
        returnByValue: true,
        expression:
          "document.readyState==='complete'&&!!document.querySelector('h1')",
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
  const controls = [...document.querySelectorAll('button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), label:has(input[type=checkbox]), label:has(input[type=radio]), main a, ul a, a[href]')]
    .map((e) => ({ tag: e.tagName, h: r(e).height, fs: parseFloat(getComputedStyle(e).fontSize), isInput: e.tagName === 'INPUT' }));
  const cards = [...document.querySelectorAll('ul > li > a')].map((a) => ({ left: r(a).left, right: r(a).right, top: r(a).top, bottom: r(a).bottom, sw: a.scrollWidth, cw: a.clientWidth }));
  const wide = [...document.querySelectorAll('body *')].filter((e) => r(e).right > innerWidth + 0.5).length;
  return { controls, cards, wide, iw: innerWidth, docOverflow: document.documentElement.scrollWidth > innerWidth };
})()`;

describe.skipIf(!HAS_CHROME)("T6.40b clients admin in real Chrome", () => {
  for (const w of [320, 360, 412]) {
    for (const which of ["list", "edit"]) {
      it(`${which} at ${w}px: no horizontal overflow, controls >= 48px, inputs >= 16px`, async () => {
        const m = await run(await page(which), w, MEASURE);
        expect(m.controls.length).toBeGreaterThan(3);
        expect(m.docOverflow).toBe(false);
        expect(m.wide).toBe(0);
        for (const c of m.controls) {
          expect(c.h, JSON.stringify(c)).toBeGreaterThanOrEqual(47.5);
          if (c.isInput) expect(c.fs).toBeGreaterThanOrEqual(16);
        }
      }, 60000);
    }
    it(`list at ${w}px: clients are stacked cards (one column, full width, no overlap)`, async () => {
      const m = await run(await page("list"), w, MEASURE);
      expect(m.cards.length).toBe(3);
      for (const [i, c] of m.cards.entries()) {
        expect(c.left).toBe(m.cards[0].left);
        expect(c.right).toBe(m.cards[0].right);
        expect(c.right).toBeLessThanOrEqual(m.iw);
        expect(c.sw).toBeLessThanOrEqual(c.cw + 1);
        if (i) expect(c.top).toBeGreaterThanOrEqual(m.cards[i - 1].bottom);
      }
    }, 60000);
  }
  it("list at 1024px: one grid row per client (desktop table-like layout)", async () => {
    const m = await run(
      await page("list"),
      1024,
      `(() => [...document.querySelectorAll('ul > li > a')].map((a) => [...a.children].map((c) => c.getBoundingClientRect().left)))()`,
    );
    expect(m.length).toBe(3);
    for (const lefts of m)
      expect(lefts, JSON.stringify(lefts)).toEqual(
        [...lefts].sort((a, b) => a - b),
      );
    for (const lefts of m) expect(new Set(lefts.map(Math.round)).size).toBe(4);
  }, 60000);
});
