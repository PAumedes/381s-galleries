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
        entry: `${process.cwd()}/test/support/client-pending-entry.tsx`,
        formats: ["iife"],
        name: "App",
      },
    },
  });
  const chunks = Array.isArray(built)
    ? built.flatMap((o) => o.output)
    : built.output;
  const bundled = chunks.find((c) => c.type === "chunk").code;
  const srcs = sourcesOf("app/components");
  const style = await css(classesOf(srcs));
  const file = join(dir, "page.html");
  writeFileSync(
    file,
    `<!doctype html><html id=html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>${style}</style><body style="margin:0"><div id=root></div><script>${bundled.replace(/<\/script/g, "<\\/script")}</script>`,
  );
  return file;
}

async function measure(file, { width, lang, dir }) {
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
      height: 800,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send("Page.enable");
    await send("Page.navigate", { url: `file://${file}#${lang}` });
    await until(() => ev("!!document.querySelector('form button')"), "form");
    await ev(`document.documentElement.dir='${dir}'`);
    await ev("document.querySelector('form input[name=name]').value='Ana'");
    await ev("document.querySelector('form button').click()");
    await until(
      () => ev("document.querySelector('form button')?.disabled === true"),
      "pending button",
    );
    return await ev(`(() => {
      const b = document.querySelector('form button');
      const s = b.querySelector('span:not([data-spinner])');
      const r = b.getBoundingClientRect();
      return {
        busy: b.getAttribute('aria-busy'), text: s.textContent,
        h: r.height, left: r.left, right: r.right, iw: innerWidth,
        docOverflow: document.documentElement.scrollWidth > innerWidth,
        btnClip: b.scrollWidth > b.clientWidth + 1,
        labelClip: s.scrollWidth > s.clientWidth + 1,
      };
    })()`);
  } finally {
    ch.kill();
  }
}

describe.skipIf(!HAS_CHROME)("T6.46 pending submit button in Chrome", () => {
  let file;
  const cases = [];
  for (const lang of ["es", "en"])
    for (const width of [320, 360, 412])
      for (const dir of ["ltr", "rtl"]) cases.push({ lang, width, dir });
  for (const c of cases) {
    it(`${c.lang} ${c.width}px ${c.dir}: no overflow, 48px, label not clipped`, async () => {
      file ??= await buildPage(mkdtempSync(join(tmpdir(), "pending-")));
      const m = await measure(file, c);
      expect(m.busy).toBe("true");
      expect(m.text).toMatch(/…$/);
      expect(m.docOverflow).toBe(false);
      expect(m.h).toBeGreaterThanOrEqual(48);
      expect(m.left).toBeGreaterThanOrEqual(0);
      expect(m.right).toBeLessThanOrEqual(m.iw);
      expect(m.btnClip).toBe(false);
      expect(m.labelClip).toBe(false);
    }, 90000);
  }
});
