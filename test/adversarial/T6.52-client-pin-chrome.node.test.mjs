/* global WebSocket */
import process from "node:process";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { launchChrome, until } from "../support/chrome.mjs";
import { classesOf, css, sourcesOf } from "../support/tailwind-css.mjs";

const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

async function buildPage(dir) {
  const built = await build({
    configFile: false,
    logLevel: "silent",
    root: process.cwd(),
    esbuild: { jsx: "automatic", jsxDev: false },
    define: { "process.env.NODE_ENV": '"production"' },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: `${process.cwd()}/test/support/client-pin-entry.tsx`,
        formats: ["iife"],
        name: "App",
      },
    },
  });
  const chunks = Array.isArray(built)
    ? built.flatMap((o) => o.output)
    : built.output;
  const bundled = chunks.find((c) => c.type === "chunk").code;
  const style = await css(classesOf(sourcesOf("app/components")));
  const file = join(dir, "page.html");
  writeFileSync(
    file,
    `<!doctype html><html id=html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>${style}</style><body data-admin style="margin:0;padding:16px"><div id=root></div><script>${bundled.replace(/<\/script/g, "<\\/script")}</script>`,
  );
  return file;
}

const PIN_FORM = "form:has(input[name=pin])";
// T6.54: the submit button sits next to "remove", outside the form (form=...).
const SET_BTN = "button[form=client-pin-set]";
const MEASURE = `(() => {
  const r = (e) => e.getBoundingClientRect();
  const sec = document.querySelector('${PIN_FORM}').closest('section');
  const controls = [...sec.querySelectorAll('button, input:not([type=hidden])')].map((e) => ({
    tag: e.tagName, name: e.name || e.textContent, h: r(e).height, left: r(e).left, right: r(e).right,
    fs: parseFloat(getComputedStyle(e).fontSize), clip: e.scrollWidth > e.clientWidth + 1 && e.tagName === 'BUTTON',
  }));
  const wide = [...sec.querySelectorAll('*')].filter((e) => r(e).right > innerWidth + 0.5 || r(e).left < -0.5).length;
  const alert = sec.querySelector('[role=alert]');
  const del = document.querySelector('form:has(input[name=intent][value=delete])');
  const delWide = [del, ...del.querySelectorAll('*')].filter((e) => r(e).right > innerWidth + 0.5 || r(e).left < -0.5).length;
  const delClip = [...del.querySelectorAll('p')].some((e) => e.scrollWidth > e.clientWidth + 1);
  return { controls, wide, delWide, delClip, delHasPin: /PIN/.test(del.querySelector('p').textContent), iw: innerWidth, docOverflow: document.documentElement.scrollWidth > innerWidth,
    alertClip: alert ? alert.scrollWidth > alert.clientWidth + 1 : null,
    busy: [...sec.querySelectorAll('button')].filter((b) => b.getAttribute('aria-busy') === 'true').map((b) => b.textContent) };
})()`;

async function measure(file, { width, lang, dir }, pending) {
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
    const ev = async (expression) =>
      (await send("Runtime.evaluate", { expression, returnByValue: true }))
        ?.result?.value;
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send("Page.enable");
    await send("Page.navigate", { url: `file://${file}#${lang}` });
    await until(() => ev(`!!document.querySelector('${PIN_FORM}')`), "form");
    await ev(`document.documentElement.dir='${dir}'`);
    if (pending) {
      await ev(
        `document.querySelector('${PIN_FORM} input[name=pin]').value='123456'`,
      );
      await ev(`document.querySelector('${SET_BTN}').click()`);
      await until(
        () =>
          ev(
            `document.querySelector('${SET_BTN}')?.getAttribute('aria-busy') === 'true'`,
          ),
        "pending button",
      );
    }
    return await ev(MEASURE);
  } finally {
    ch.kill();
  }
}

describe.skipIf(!HAS_CHROME)("T6.52 client PIN field in Chrome", () => {
  let file;
  const cases = [];
  for (const lang of ["es", "en"])
    for (const width of [320, 360, 412])
      for (const dir of ["ltr", "rtl"]) cases.push({ lang, width, dir });
  for (const c of cases)
    for (const pending of [false, true]) {
      it(`${c.lang} ${c.width}px ${c.dir} ${pending ? "pending" : "idle"}: no overflow, controls >= 48px, inputs >= 16px`, async () => {
        file ??= await buildPage(mkdtempSync(join(tmpdir(), "client-pin-")));
        const m = await measure(file, c, pending);
        expect(m.controls.length).toBeGreaterThanOrEqual(3); // input, change, remove
        expect(m.docOverflow).toBe(false);
        expect(m.wide).toBe(0);
        // the delete warning of a PIN client (longer text) stays inside too
        expect(m.delHasPin).toBe(true);
        expect(m.delWide).toBe(0);
        expect(m.delClip).toBe(false);
        expect(m.alertClip).toBe(false);
        for (const k of m.controls) {
          expect(k.h, JSON.stringify(k)).toBeGreaterThanOrEqual(47.5);
          expect(k.left).toBeGreaterThanOrEqual(0);
          expect(k.right).toBeLessThanOrEqual(m.iw);
          expect(k.clip).toBe(false);
          if (k.tag === "INPUT") expect(k.fs).toBeGreaterThanOrEqual(16);
        }
        if (pending) expect(m.busy.length).toBe(1);
      }, 90000);
    }
});
