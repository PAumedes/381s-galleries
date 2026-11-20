import process from "node:process";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";
import { css } from "../support/tailwind-css.mjs";

const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

// A real lightbox (production components + app.css) in headless Chrome.
const ENTRY = `
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Lightbox } from "${process.cwd()}/app/components/Lightbox";
import { makeT } from "${process.cwd()}/app/i18n/t";
import { en } from "${process.cwd()}/app/i18n/en";
const photos = Array.from({ length: 8 }, (_, i) => ({
  id: "p" + i, width: 3000, height: 2000, set: "A", v: "1",
  variants: { web: true, ig: true },
}));
const t = makeT("en", en);
const state = (window.__state = { index: 3, closed: false });
function App() {
  const [i, setI] = useState(3);
  const [open, setOpen] = useState(true);
  state.index = i;
  state.closed = !open;
  if (!open) return null;
  return <Lightbox photos={photos} index={i} t={t} onFavorite={() => {}}
    onClose={() => setOpen(false)} onIndexChange={setI} />;
}
createRoot(document.getElementById("root")).render(<App />);
`;

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#68a"/></svg>';

function sources(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
    .join("\n");
}

const ENTRY_ID = `${process.cwd()}/t634-entry.tsx`; // virtual, never on disk
async function bundle() {
  const out = await build({
    configFile: false,
    logLevel: "silent",
    root: process.cwd(),
    esbuild: { jsx: "automatic", jsxDev: false },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "entry",
        resolveId: (id) => (id === ENTRY_ID ? ENTRY_ID : null),
        load: (id) => (id === ENTRY_ID ? ENTRY : null),
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: ENTRY_ID, formats: ["iife"], name: "App" },
    },
  });
  const chunks = Array.isArray(out) ? out.flatMap((o) => o.output) : out.output;
  return chunks.find((c) => c.type === "chunk").code;
}

let server;
let origin;
beforeAll(async () => {
  if (!HAS_CHROME) return;
  const js = await bundle();
  const candidates = [
    ...new Set(sources("app/components").split(/[\s"'`]+/)),
  ].filter(Boolean);
  const style = await css(candidates);
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/img/")) {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end(SVG);
    } else if (url === "/app.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(js);
    } else if (url === "/app.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(style);
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        '<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/app.css><body style="margin:0"><div id=root></div><script src=/app.js></script>',
      );
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
}, 60000);
afterAll(() => server?.close());

async function open({ phone }) {
  const { ch, list } = await launchChrome();
  const cdp = await connectCdp(list);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: phone ? 412 : 1024,
    height: phone ? 800 : 700,
    deviceScaleFactor: 2,
    mobile: phone,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: phone,
    maxTouchPoints: 5,
  });
  await cdp.send("Page.navigate", { url: origin });
  await cdp.send("Runtime.enable");
  await until(
    () =>
      cdp.evaluate(
        `(() => { const i = document.querySelector('[data-testid=lightbox-img]'); return !!i && i.complete && i.naturalWidth > 0; })()`,
      ),
    "lightbox image",
  ).catch(async (e) => {
    const html = await cdp.evaluate("document.body.innerHTML.slice(0, 400)");
    ch.kill();
    const errs = cdp.events
      .filter((m) => m.method === "Runtime.exceptionThrown")
      .map((m) => m.params.exceptionDetails.exception?.description);
    throw new Error(`${e.message}; body: ${html}; errors: ${errs}`);
  });
  const touch = (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  return { ch, cdp, touch };
}

const photoTransform = `getComputedStyle(document.querySelector('[data-testid=lightbox-img]')).transform`;
const size = (sel) =>
  `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()`;
const font = (sel) =>
  `getComputedStyle(document.querySelector(${JSON.stringify(sel)})).fontSize`;

describe.skipIf(!HAS_CHROME)("T6.34 lightbox on a 412px touch phone", () => {
  it("a swipe down moves the photo (and fades the backdrop) before closing", async () => {
    const { ch, cdp, touch } = await open({ phone: true });
    try {
      expect(await cdp.evaluate(photoTransform)).toBe("none");
      await cdp.evaluate(
        `window.__anim = 0; const a = Element.prototype.animate; Element.prototype.animate = function (...x) { window.__anim++; return a.apply(this, x); }`,
      );
      await touch("touchStart", 206, 250);
      for (let y = 250; y <= 340; y += 15) await touch("touchMove", 206, y);
      const moved = await until(async () => {
        const v = await cdp.evaluate(photoTransform);
        return v !== "none" && v;
      }, "photo to follow the finger");
      expect(moved).toMatch(/^matrix/);
      expect(await cdp.evaluate("window.__state.closed")).toBe(false);
      const op = await cdp.evaluate(
        `Number(getComputedStyle(document.querySelector('[data-lb-backdrop]')).opacity)`,
      );
      expect(op).toBeLessThan(1);
      await touch("touchEnd");
      await until(() => cdp.evaluate("window.__state.closed"), "close");
      // It closed through the exit animation (photo + backdrop), not at once.
      expect(await cdp.evaluate("window.__anim")).toBeGreaterThanOrEqual(2);
    } finally {
      cdp.close();
      ch.kill();
    }
  }, 60000);

  it("tapping the right/left edge of the photo goes next/previous", async () => {
    const { ch, cdp, touch } = await open({ phone: true });
    try {
      const tap = async (x, y) => {
        await touch("touchStart", x, y);
        await touch("touchEnd");
      };
      await tap(390, 220); // above the round side button, on the photo's edge
      await until(
        async () => (await cdp.evaluate("window.__state.index")) === 4,
        "next",
      );
      await tap(20, 220);
      await until(
        async () => (await cdp.evaluate("window.__state.index")) === 3,
        "previous",
      );
      // The centre is not an edge: no navigation (it closes on empty backdrop
      // only; the photo itself does nothing).
      await tap(206, 400);
      expect(await cdp.evaluate("window.__state.index")).toBe(3);
    } finally {
      cdp.close();
      ch.kill();
    }
  }, 60000);

  it("top bar and side buttons have phone sizes", async () => {
    const { ch, cdp } = await open({ phone: true });
    try {
      const close = "button[aria-label=Close]";
      const [w, h] = await cdp.evaluate(size(close));
      expect(Math.min(w, h)).toBeGreaterThanOrEqual(56);
      expect(await cdp.evaluate(size(`${close} svg`))).toEqual([32, 32]);
      expect(await cdp.evaluate(font("[data-lb-scrim] + span"))).toBe("18px");
      expect(
        await cdp.evaluate(
          `getComputedStyle(document.querySelector('[data-lb-scrim]')).backgroundImage`,
        ),
      ).toContain("linear-gradient");
      for (const name of ["Previous", "Next"]) {
        const sel = `button[aria-label=${name}]`;
        const [bw, bh] = await cdp.evaluate(size(sel));
        expect(Math.min(bw, bh)).toBeGreaterThanOrEqual(48);
        expect(
          await cdp.evaluate(
            `getComputedStyle(document.querySelector('${sel}')).visibility`,
          ),
        ).toBe("visible");
      }
    } finally {
      cdp.close();
      ch.kill();
    }
  }, 60000);

  it("desktop keeps its sizes (44px buttons, 24px icons, wide side zones)", async () => {
    const { ch, cdp } = await open({ phone: false });
    try {
      const close = "button[aria-label=Close]";
      expect(await cdp.evaluate(size(close))).toEqual([44, 44]);
      expect(await cdp.evaluate(size(`${close} svg`))).toEqual([24, 24]);
      const [w] = await cdp.evaluate(size("button[aria-label=Next]"));
      expect(w).toBeGreaterThan(100);
      expect(
        await cdp.evaluate(
          `getComputedStyle(document.querySelector('[data-lb-scrim]')).display`,
        ),
      ).toBe("none");
    } finally {
      cdp.close();
      ch.kill();
    }
  }, 60000);
});
