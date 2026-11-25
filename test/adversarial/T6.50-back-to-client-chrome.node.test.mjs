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
import { GalleryView } from "../../app/components/GalleryView.tsx";
import { es } from "../../app/i18n/es.ts";
import { launchChrome } from "../support/chrome.mjs";
import { css } from "../support/tailwind-css.mjs";

// T6.50: the back-to-client strip in real Chrome, every cover layout, LTR/RTL.
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAMES = {
  short: "ACME",
  long: "Cliente Ñandú ".repeat(12) + "A".repeat(60),
  rtl: "مرحبا بالعالم ".repeat(10) + "👩‍👩‍👧‍👦",
};
const gallery = (coverLayout) => ({
  slug: "boda",
  requireEmail: false,
  title: "Boda Ana y Luis",
  eventDate: "2026-03-14",
  coverPhotoId: null,
  allowBulk: false,
  palette: "claro",
  coverLayout,
  gridStyle: "filas",
  gridGap: "normal",
  sets: [],
});

async function html(layout, name, dir) {
  const link = { name, href: "/acme?pagina=2" };
  const routes = [
    {
      id: "root",
      path: "/",
      loader: () => ({ lang: "es", messages: es, studioName: "Estudio" }),
      children: [
        {
          path: "acme",
          Component: () =>
            h(GalleryView, {
              gallery: gallery(layout),
              photos: [],
              backToClient: link,
            }),
        },
      ],
    },
  ];
  const handler = createStaticHandler(routes);
  const ctx = await handler.query(new Request("http://x/acme"));
  const router = createStaticRouter(handler.dataRoutes, ctx);
  const inner = renderToString(
    h(StaticRouterProvider, { router, context: ctx, hydrate: false }),
  );
  const cls = [...inner.matchAll(/class="([^"]*)"/g)]
    .flatMap((m) =>
      m[1].replaceAll("&gt;", ">").replaceAll("&amp;", "&").split(/\s+/),
    )
    .filter(Boolean);
  return `<!doctype html><html dir="${dir}"><meta name=viewport content="width=device-width,initial-scale=1"><style>${await css(cls)}</style><body style="margin:0">${inner}`;
}

async function run(page, width, expr) {
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
      height: 700,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send("Page.enable");
    await send("Page.navigate", {
      url: "data:text/html;charset=utf-8," + encodeURIComponent(page),
    });
    for (let i = 0; i < 200; i++) {
      const r = await send("Runtime.evaluate", {
        returnByValue: true,
        expression:
          "document.readyState==='complete'&&!!document.querySelector('header')",
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
  const a = document.querySelector('a[href^="/acme"]');
  const hd = document.querySelector('header');
  const svg = a.querySelector('svg');
  const span = a.querySelector('span');
  return {
    a: { l: r(a).left, r: r(a).right, t: r(a).top, b: r(a).bottom, h: r(a).height },
    header: { t: r(hd).top, b: r(hd).bottom },
    clipped: span.scrollWidth > span.clientWidth,
    flip: getComputedStyle(svg).scale + " " + getComputedStyle(svg).transform,
    docOverflow: document.documentElement.scrollWidth > innerWidth,
    iw: innerWidth, ih: innerHeight,
  };
})()`;

describe.skipIf(!HAS_CHROME)("T6.50 back-to-client link in Chrome", () => {
  for (const layout of ["completa", "dividida", "centrada", "minima"])
    for (const dir of ["ltr", "rtl"])
      for (const w of [320, 360, 412])
        it(`${layout} ${dir} ${w}px: 48px target, inside the viewport, above the cover, no overflow`, async () => {
          const name = dir === "rtl" ? NAMES.rtl : NAMES.long;
          const m = await run(await html(layout, name, dir), w, MEASURE);
          expect(m.docOverflow).toBe(false);
          expect(m.a.h).toBeGreaterThanOrEqual(48);
          expect(m.a.l).toBeGreaterThanOrEqual(0);
          expect(m.a.r).toBeLessThanOrEqual(m.iw);
          // never over the cover (logo / title): the strip ends where the cover starts
          expect(m.a.b).toBeLessThanOrEqual(m.header.t + 0.5);
          // the cover still fits the first screen
          expect(m.header.b).toBeLessThanOrEqual(m.ih + 0.5);
          expect(m.clipped).toBe(true);
          if (dir === "rtl") expect(m.flip).toMatch(/-1/);
          else expect(m.flip).not.toMatch(/-1/);
        }, 60000);

  it("a short name is not clipped and sits at the start edge", async () => {
    const m = await run(
      await html("completa", NAMES.short, "ltr"),
      320,
      MEASURE,
    );
    expect(m.clipped).toBe(false);
    expect(m.a.l).toBeLessThan(16);
    const rtl = await run(
      await html("completa", NAMES.short, "rtl"),
      320,
      MEASURE,
    );
    expect(rtl.a.r).toBeGreaterThan(320 - 16);
  }, 60000);
});
