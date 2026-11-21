/* global WebSocket, Request */
import process from "node:process";
import { setTimeout } from "node:timers";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from "react-router";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { GalleryList } from "../../app/components/admin/GalleryList.tsx";
import { es } from "../../app/i18n/es.ts";
import { launchChrome } from "../support/chrome.mjs";

const require = createRequire(import.meta.url);
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
};
const rows = [
  { ...base, id: "a", title: "Boda Ana" },
  { ...base, id: "b", title: "x".repeat(200), issueCount: 3, mode: "proofing" },
  {
    ...base,
    id: "c",
    title: "مرحبا بالعالم ".repeat(8) + "👩‍👩‍👧‍👦🎉",
    clientName: "Ñandú ".repeat(20),
    status: "draft",
  },
  {
    ...base,
    id: "d",
    title: "Cumple de Tomás y Mía",
    status: "archived",
    photoCount: 12345,
    coverPhotoId: "p1",
  },
];

async function css(candidates) {
  const app = readFileSync("app/app.css", "utf8").replace(
    /@import "@fontsource[^;]*;/,
    "",
  );
  const c = await compile(app, {
    base: process.cwd() + "/app",
    loadStylesheet: async (id, b) => {
      const p = id === "tailwindcss" ? "tailwindcss/index.css" : id;
      const file = p.startsWith(".")
        ? require.resolve(p, { paths: [b] })
        : require.resolve(p, { paths: [process.cwd()] });
      return { path: file, base: b, content: readFileSync(file, "utf8") };
    },
  });
  return c.build(candidates);
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
    for (let i = 0; i < 100; i++) {
      const r = await send("Runtime.evaluate", {
        returnByValue: true,
        expression:
          "document.readyState==='complete'&&!!document.querySelector('tbody tr')",
      });
      if (r?.result?.value) break;
      await sleep(100);
    }
    const r = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: expr,
    });
    return r.result.value;
  } finally {
    ch.kill();
  }
}

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
            h(GalleryList, { galleries: rows, filter: "todas", total: 4 }),
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

const MEASURE = `(() => {
  const r = (e) => e.getBoundingClientRect();
  const chips = [...document.querySelectorAll('nav a')].map((a) => ({ w: r(a).width, h: r(a).height }));
  const trs = [...document.querySelectorAll('tbody tr')].map((tr) => {
    const t = r(tr);
    const cells = [...tr.children].map((c) => ({ txt: c.textContent.trim().slice(0,30), lab: getComputedStyle(c, "::after").content, disp: getComputedStyle(c).display, w: r(c).width, right: r(c).right, left: r(c).left, top: r(c).top }));
    const hit = document.elementFromPoint(t.left + 20, t.top + t.height / 2);
    return { h: t.height, right: t.right, sw: tr.scrollWidth, cells, hitTag: hit && hit.tagName, hitLink: !!(hit && hit.closest('a')) };
  });
  return { chips, trs, docOverflow: document.documentElement.scrollWidth > innerWidth, iw: innerWidth };
})()`;

describe.skipIf(!HAS_CHROME)("T6.36 real GalleryList in Chrome", () => {
  for (const w of [360, 320]) {
    it(`${w}px: filter chips are >=44px wide too (touch target)`, async () => {
      const m = await run(await page(), w, MEASURE);
      for (const c of m.chips) {
        expect(c.h).toBeGreaterThanOrEqual(44);
        expect(c.w).toBeGreaterThanOrEqual(44);
      }
    }, 60000);
    it(`${w}px: no row overflows the viewport and the document never scrolls sideways`, async () => {
      const m = await run(await page(), w, MEASURE);
      expect(m.docOverflow).toBe(false);
      for (const t of m.trs) {
        expect(t.right).toBeLessThanOrEqual(m.iw);
        expect(t.sw).toBeLessThanOrEqual(m.iw);
        for (const c of t.cells)
          expect(c.right).toBeLessThanOrEqual(m.iw + 0.5);
      }
    }, 60000);
    it(`${w}px: the cover thumbnail sits LEFT of the title (cover, title, badge order)`, async () => {
      const m = await run(await page(), w, MEASURE);
      for (const t of m.trs) {
        const [cover, title] = t.cells;
        expect(cover.left, JSON.stringify(t.cells)).toBeLessThan(title.left);
      }
    }, 60000);
    it(`${w}px: the title is the first line of the row (above status and date)`, async () => {
      const m = await run(await page(), w, MEASURE);
      for (const t of m.trs) {
        const [, title, status] = t.cells;
        expect(title.top, JSON.stringify(t.cells)).toBeLessThan(status.top);
      }
    }, 60000);
    it(`${w}px: a gallery with exactly 1 photo does not read "1 fotos"`, async () => {
      const m = await run(await page(), w, MEASURE);
      const photos = m.trs[0].cells[4];
      expect(photos.txt).toBe("1");
      expect(photos.lab).not.toBe('"Fotos"');
    }, 60000);
    it(`${w}px: tapping the cover hits the row link (whole row is the tap target)`, async () => {
      const m = await run(await page(), w, MEASURE);
      for (const t of m.trs)
        expect(t.hitLink, JSON.stringify(t.cells)).toBe(true);
    }, 60000);
  }
});
