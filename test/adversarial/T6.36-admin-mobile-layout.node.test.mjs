/* global WebSocket */
import process from "node:process";
import { setTimeout } from "node:timers";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { compile } from "tailwindcss";
import { launchChrome } from "../support/chrome.mjs";

const require = createRequire(import.meta.url);
const LIST = readFileSync("app/components/admin/GalleryList.tsx", "utf8");
const HEADER = readFileSync(
  "app/components/admin/gallery-edit/EditorHeader.tsx",
  "utf8",
);
const ES = readFileSync("app/i18n/es.admin.ts", "utf8");
const str = (k) => new RegExp(`"${k}": "([^"]*)"`).exec(ES)[1];
const cls = (src, name) =>
  new RegExp(`export const ${name} =\\s*"([^"]*)"`).exec(src)[1];

const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

async function css(candidates) {
  const app = readFileSync("app/app.css", "utf8").replace(
    /@import "@fontsource[^;]*;/,
    "",
  );
  const c = await compile(app, {
    base: process.cwd() + "/app",
    loadStylesheet: async (id, base) => {
      const path = id === "tailwindcss" ? "tailwindcss/index.css" : id;
      const file = path.startsWith(".")
        ? require.resolve(path, { paths: [base] })
        : require.resolve(path, { paths: [process.cwd()] });
      return { path: file, base, content: readFileSync(file, "utf8") };
    },
  });
  return c.build(candidates);
}

async function page() {
  const nav = cls(LIST, "FILTER_NAV_CLS");
  const chip = cls(LIST, "FILTER_CHIP_CLS");
  const actions = cls(HEADER, "HEADER_ACTIONS_CLS");
  const action = cls(HEADER, "HEADER_ACTION_CLS");
  const labels = ["todas", "publicadas", "borradores", "archivadas"].map((f) =>
    str(`admin.filter.${f}`),
  );
  const all = [nav, chip, actions, action, "bg-ink text-paper"].flatMap((s) =>
    s.split(/\s+/),
  );
  const style = await css(all);
  const chips = labels
    .map(
      (l, i) =>
        `<a href="#" class="${chip} ${i === 0 ? "bg-ink text-paper" : "text-grey-700"}">${l}</a>`,
    )
    .join("");
  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>${style}</style><body style="margin:0;padding:16px"><div id=wrap data-admin><nav id=nav class="${nav}">${chips}</nav><div id=acts class="${actions}"><span id=a class="${action} bg-ink text-paper">${str("admin.state.published")}</span><a id=b href="#" class="${action}">${str("admin.edit.preview")}</a></div></div>`;
}

async function measure(html, width) {
  const { ch, list } = await launchChrome();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
      height: 800,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send("Page.enable");
    await send("Page.navigate", {
      url: "data:text/html;charset=utf-8," + encodeURIComponent(html),
    });
    for (let i = 0; i < 100; i++) {
      const ready = await send("Runtime.evaluate", {
        returnByValue: true,
        expression:
          "document.readyState === 'complete' && !!document.getElementById('b')",
      });
      if (ready?.result?.value) break;
      await sleep(100);
    }
    const r = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const rect = (e) => e.getBoundingClientRect();
        const chips = [...document.querySelectorAll('#nav a')].map(rect);
        const nav = document.getElementById('nav');
        const a = rect(document.getElementById('a'));
        const b = rect(document.getElementById('b'));
        return {
          tops: chips.map((c) => Math.round(c.top)),
          minChipH: Math.min(...chips.map((c) => c.height)),
          scrolls: nav.scrollWidth > nav.clientWidth + 1,
          aH: a.height, bH: b.height, aW: a.width, bW: b.width,
          aTop: a.top, bTop: b.top,
          used: chips[chips.length - 1].right - rect(nav).left, cw: nav.clientWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth,
        };
      })()`,
    });
    return r.result.value;
  } finally {
    ch.kill();
  }
}

describe.skipIf(!HAS_CHROME)("T6.36 admin mobile layout (real Chrome)", () => {
  for (const w of [360, 412]) {
    it(`${w}px: filter chips are one row (no sideways scroll) with >=44px targets`, async () => {
      const m = await measure(await page(), w);
      expect(new Set(m.tops).size).toBe(1);
      expect(m.scrolls).toBe(false);
      expect(m.used).toBeLessThanOrEqual(m.cw - 8); // margin for font differences
      expect(m.minChipH).toBeGreaterThanOrEqual(44);
      expect(m.pageOverflow).toBe(false);
    }, 30000);
    it(`${w}px: Publicada and Vista previa have equal height (>=48px) and width on one row`, async () => {
      const m = await measure(await page(), w);
      expect(m.aH).toBeGreaterThanOrEqual(48);
      expect(Math.abs(m.aH - m.bH)).toBeLessThan(0.5);
      expect(Math.abs(m.aW - m.bW)).toBeLessThan(1);
      expect(Math.abs(m.aTop - m.bTop)).toBeLessThan(0.5);
    }, 30000);
  }
});
