/* global Request */
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
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";
import { css } from "../support/tailwind-css.mjs";

// T6.40f: the states the earlier Chrome tests did not render: server feedback
// (long error / saved messages, field errors) on the client screens, in LTR and RTL.
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

const long = "Ñandú ".repeat(30) + "👩‍👩‍👧‍👦" + "A".repeat(90);
const client = {
  id: "a",
  name: long,
  slug: "x".repeat(60),
  pageEnabled: true,
  defaultMode: "delivery",
  defaultShowOnHome: false,
};
const albums = [
  {
    id: "g1",
    title: long,
    slug: "y".repeat(60),
    status: "draft",
    mode: "delivery",
  },
];
const clients = [
  {
    id: "a",
    name: long,
    slug: "z".repeat(60),
    pageEnabled: true,
    albumCount: 3,
  },
];
const bad = {
  intent: "save",
  ok: false,
  error: long,
  fieldErrors: { name: long, slug: long },
};
const good = { intent: "apply-defaults", ok: true, message: long };

async function page(which, data, dir) {
  const Component = () =>
    which === "list"
      ? h(ClientList, { clients, message: long, actionData: data })
      : h(ClientEditView, {
          client,
          albums,
          publicPage: { visible: 1, reason: null },
          actionData: data,
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
  return `<!doctype html><html dir="${dir}"><meta name=viewport content="width=device-width,initial-scale=1"><style>${await css(cls)}</style><body data-admin style="margin:0;padding:16px">${inner}`;
}

const MEASURE = `(() => {
  const r = (e) => e.getBoundingClientRect();
  const controls = [...document.querySelectorAll('button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), a[href]')]
    .map((e) => ({ tag: e.tagName, h: r(e).height, fs: parseFloat(getComputedStyle(e).fontSize), isInput: e.tagName === 'INPUT' }));
  const wide = [...document.querySelectorAll('body *')].filter((e) => r(e).right > innerWidth + 0.5 || r(e).left < -0.5).map((e) => e.tagName + '.' + e.className).slice(0, 5);
  return { controls, wide, text: document.body.innerText.length, docOverflow: document.documentElement.scrollWidth > innerWidth };
})()`;

async function measure(html, width) {
  const { ch, list } = await launchChrome();
  try {
    const cdp = await connectCdp(list);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", {
      url: "data:text/html;charset=utf-8," + encodeURIComponent(html),
    });
    await until(
      () =>
        cdp.evaluate(
          "document.readyState==='complete'&&!!document.querySelector('h1')",
        ),
      "page",
    );
    return await cdp.evaluate(MEASURE);
  } finally {
    ch.kill();
  }
}

describe.skipIf(!HAS_CHROME)("T6.40f feedback states in real Chrome", () => {
  for (const dir of ["ltr", "rtl"])
    for (const w of [320, 360, 412])
      for (const [which, data] of [
        ["list", bad],
        ["list", good],
        ["edit", bad],
        ["edit", good],
      ])
        it(`${which} with ${data.ok ? "saved" : "error"} message, ${dir}, ${w}px: no overflow, 48px controls`, async () => {
          const m = await measure(await page(which, data, dir), w);
          expect(m.controls.length).toBeGreaterThan(3);
          expect(m.text).toBeGreaterThan(600);
          expect(m.docOverflow).toBe(false);
          expect(m.wide).toEqual([]);
          for (const c of m.controls) {
            expect(c.h, JSON.stringify(c)).toBeGreaterThanOrEqual(47.5);
            if (c.isInput) expect(c.fs).toBeGreaterThanOrEqual(16);
          }
        }, 60000);
});
