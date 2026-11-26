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
import { GalleryList } from "../../app/components/admin/GalleryList.tsx";
import { es } from "../../app/i18n/es.ts";
import { launchChrome } from "../support/chrome.mjs";
import { css } from "../support/tailwind-css.mjs";

const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const long = "Ñandú ".repeat(30);
const base = {
  slug: "s",
  clientName: null,
  eventDate: "2026-11-01",
  status: "published",
  mode: "delivery",
  expiresAt: null,
  expired: false,
  coverPhotoId: null,
  photoCount: 1,
  views: 0,
  downloads: 0,
  issueCount: 0,
  deleting: false,
  client: null,
};
const clients = [
  { id: "a", name: "Acme", slug: "acme" },
  { id: "b", name: long, slug: "x".repeat(60) },
];
const rows = [
  { ...base, id: "1", title: "Boda Ana", client: clients[0] },
  {
    ...base,
    id: "2",
    title: "x".repeat(200),
    client: clients[1],
    issueCount: 3,
  },
  {
    ...base,
    id: "3",
    title: "Con ambos",
    clientName: long,
    client: { id: "c", name: "مرحبا بالعالم ".repeat(8) + "👩‍👩‍👧‍👦", slug: "rtl" },
  },
  { ...base, id: "4", title: "Sin cliente" },
];

async function page() {
  const routes = [
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "es", messages: es }),
      children: [
        {
          path: "admin",
          Component: () =>
            h(GalleryList, {
              galleries: rows,
              filter: "todas",
              total: 4,
              clients,
              clientFilter: "",
            }),
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
          "document.readyState==='complete'&&!!document.querySelector('tbody tr')",
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
  const sel = document.querySelector('select');
  const trs = [...document.querySelectorAll('tbody tr')].map((tr) => {
    const t = r(tr);
    const f = tr.querySelector('[data-client-folder]');
    const title = tr.querySelector('a');
    return { right: t.right, sw: tr.scrollWidth, folder: f && { txt: f.textContent.trim().slice(0, 12), top: r(f).top, right: r(f).right, h: r(f).height, over: f.scrollWidth > f.clientWidth + 1, fits: r(f).right <= innerWidth }, titleBottom: r(title).bottom, cells: [...tr.children].map((c) => r(c).right) };
  });
  return {
    sel: { h: r(sel).height, w: r(sel).width, right: r(sel).right, fs: parseFloat(getComputedStyle(sel).fontSize) },
    trs,
    docOverflow: document.documentElement.scrollWidth > innerWidth,
    iw: innerWidth,
  };
})()`;

describe.skipIf(!HAS_CHROME)(
  "T6.40c GalleryList client name + filter in Chrome",
  () => {
    for (const w of [320, 360, 412]) {
      it(`${w}px: filter select is >=44px tall (T6.54: same as the search box), 16px text, inside the viewport`, async () => {
        const m = await run(await page(), w, MEASURE);
        expect(m.sel.h).toBeGreaterThanOrEqual(43.5);
        expect(m.sel.fs).toBeGreaterThanOrEqual(16);
        expect(m.sel.right).toBeLessThanOrEqual(m.iw);
      }, 60000);
      it(`${w}px: client names never overflow; no horizontal scroll`, async () => {
        const m = await run(await page(), w, MEASURE);
        expect(m.docOverflow).toBe(false);
        const withFolder = m.trs.filter((t) => t.folder);
        expect(withFolder.length).toBe(3);
        for (const t of m.trs) {
          expect(t.right).toBeLessThanOrEqual(m.iw);
          expect(t.sw).toBeLessThanOrEqual(m.iw);
        }
        for (const t of withFolder) {
          expect(t.folder.fits).toBe(true);
          // below the title, one line (truncated, not wrapped)
          expect(t.folder.top).toBeGreaterThanOrEqual(t.titleBottom - 1);
          expect(t.folder.h).toBeLessThan(30);
        }
      }, 60000);
    }
  },
);
