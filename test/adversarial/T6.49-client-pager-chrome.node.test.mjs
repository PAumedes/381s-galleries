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
import { ClientPage } from "../../app/components/ClientPage.tsx";
import { en } from "../../app/i18n/en.ts";
import { es } from "../../app/i18n/es.ts";
import { evalInChrome } from "../support/chrome-page.mjs";
import { css } from "../support/tailwind-css.mjs";

const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

const cover = { id: "p1", v: "abc", focus: null, aspect: 1.5 };
const items = Array.from({ length: 3 }, (_, i) => ({
  slug: `a${i}`,
  clientSlug: "acme",
  title: "Álbum " + "largo ".repeat(10),
  eventDate: "2026-03-14",
  cover,
}));

async function html(lang, pageNo, count) {
  const messages = lang === "en" ? en : es;
  const page = {
    state: "client",
    clientSlug: "acme",
    clientName: "ACME",
    items,
    page: pageNo,
    pageCount: count,
  };
  const routes = [
    {
      id: "root",
      path: "/",
      loader: () => ({ lang, messages, studioName: "Estudio" }),
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
  const dir = lang === "ar" ? "rtl" : "ltr";
  return `<!doctype html><html dir="${dir}"><meta name=viewport content="width=device-width,initial-scale=1"><style>${await css(cls)}</style><body style="margin:0">${inner}`;
}

const MEASURE = `(() => {
  const r = (e) => e.getBoundingClientRect();
  const nav = document.querySelector('nav');
  nav.scrollIntoView();
  const links = [...nav.querySelectorAll('a')].map((a) => {
    const b = r(a);
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { h: b.height, w: b.width, left: b.left, right: b.right,
      href: a.getAttribute('href'), hit: a === top || a.contains(top) };
  });
  const n = r(nav);
  return { links, nav: { left: n.left, right: n.right },
    docOverflow: document.documentElement.scrollWidth > innerWidth,
    navOverflow: nav.scrollWidth > nav.clientWidth + 1, iw: innerWidth,
    text: nav.textContent };
})()`;

describe.skipIf(!HAS_CHROME)("T6.49 client pager in Chrome", () => {
  for (const dir of ["ltr", "rtl"])
    for (const w of [320, 360, 412]) {
      it(`${dir} ${w}px: both links 48px, tappable, no overflow`, async () => {
        const src = (await html("es", 2, 12)).replace(
          "<html ",
          `<html dir="${dir}" `,
        );
        const m = await evalInChrome(
          src,
          w,
          MEASURE,
          "!!document.querySelector('nav a')",
        );
        expect(m.docOverflow).toBe(false);
        expect(m.navOverflow).toBe(false);
        expect(m.links.map((l) => l.href)).toEqual(["/acme", "/acme?pagina=3"]);
        for (const l of m.links) {
          expect(l.h).toBeGreaterThanOrEqual(48);
          expect(l.w).toBeGreaterThanOrEqual(48);
          expect(l.left).toBeGreaterThanOrEqual(0);
          expect(l.right).toBeLessThanOrEqual(m.iw);
          expect(l.hit).toBe(true);
        }
        expect(m.text).toContain("Página 2 de 12");
        // Anterior sits on the start side, Siguiente on the end side
        const [prev, next] = m.links;
        if (dir === "ltr") expect(prev.left).toBeLessThan(next.left);
        else expect(prev.left).toBeGreaterThan(next.left);
      }, 60000);
    }

  it("English last page at 320px: one link, no overflow", async () => {
    const m = await evalInChrome(
      await html("en", 12, 12),
      320,
      MEASURE,
      "!!document.querySelector('nav a')",
    );
    expect(m.docOverflow).toBe(false);
    expect(m.links.map((l) => l.href)).toEqual(["/acme?pagina=11"]);
    expect(m.text).toContain("Page 12 of 12");
    expect(m.links[0].h).toBeGreaterThanOrEqual(48);
  }, 60000);
});
