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
import { AdminGalleryPreview } from "../../app/components/admin/AdminGalleryPreview.tsx";
import { es } from "../../app/i18n/es.ts";
import { en } from "../../app/i18n/en.ts";
import { esAdmin } from "../../app/i18n/es.admin.ts";
import { enAdmin } from "../../app/i18n/en.admin.ts";
import { launchChrome } from "./chrome.mjs";
import { css } from "./tailwind-css.mjs";

export const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const data = {
  id: "g1",
  status: "archived",
  hasPin: true,
  expired: true,
  gallery: {
    slug: "boda-ana",
    requireEmail: true,
    title: "Boda Ana",
    eventDate: null,
    coverPhotoId: null,
    coverPhotoIdMobile: null,
    coverFocusMobile: null,
    mode: "proofing",
    allowBulk: false,
    allowHighres: false,
    allowWeb: false,
    allowIg: false,
    palette: "claro",
    coverLayout: "completa",
    gridStyle: "filas",
    gridGap: "normal",
    sets: [{ name: "A", count: 0 }],
  },
  photos: [],
};

async function html(lang, search) {
  const msgs = lang === "es" ? { ...es, ...esAdmin } : { ...en, ...enAdmin };
  const routes = [
    {
      id: "root",
      path: "/",
      loader: () => ({ lang, messages: msgs }),
      children: [
        { path: "p", Component: () => h(AdminGalleryPreview, { data }) },
      ],
    },
  ];
  const handler = createStaticHandler(routes);
  const ctx = await handler.query(new Request("http://x/p" + search));
  const router = createStaticRouter(handler.dataRoutes, ctx);
  const inner = renderToString(
    h(StaticRouterProvider, { router, context: ctx, hydrate: false }),
  );
  const cls = [...inner.matchAll(/class="([^"]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean);
  return { inner, style: await css(cls) };
}

export async function run(
  lang,
  width,
  { rootPx = 16, dir = "ltr", expr, search = "" },
) {
  const { inner, style } = await html(lang, search);
  const doc = `<!doctype html><html dir=${dir} style="font-size:${rootPx}px"><meta name=viewport content="width=device-width,initial-scale=1"><style>${style}</style><body style="margin:0">${inner}`;
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
      url: "data:text/html;charset=utf-8," + encodeURIComponent(doc),
    });
    for (let i = 0; i < 100; i++) {
      const r = await send("Runtime.evaluate", {
        returnByValue: true,
        expression:
          "document.readyState==='complete'&&!!document.querySelector('[data-admin-preview-bar]')",
      });
      if (r?.result?.value) break;
      await sleep(100);
    }
    return (
      await send("Runtime.evaluate", { returnByValue: true, expression: expr })
    ).result.value;
  } finally {
    ch.kill();
  }
}

export const M = `(() => {
  const b = document.querySelector('[data-admin-preview-bar]');
  const p = b.querySelector('p'), a = b.querySelector('a');
  const bb = b.getBoundingClientRect(), pb = p.getBoundingClientRect(), ab = a.getBoundingClientRect();
  const cs = getComputedStyle(a);
  return { vw: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
    bar: [bb.left, bb.right, bb.top, bb.bottom], p: [pb.left, pb.right, pb.top, pb.bottom],
    a: [ab.left, ab.right, ab.top, ab.bottom], href: a.getAttribute('href'), target: a.target, rel: a.rel,
    pAlign: getComputedStyle(p).textAlign, pbs: getComputedStyle(b).textAlign, aText: a.textContent,
    outline: cs.outlineColor, bg: getComputedStyle(b).backgroundColor };
})()`;
