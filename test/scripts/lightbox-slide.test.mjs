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

const ENTRY_ID = `${process.cwd()}/t641-entry.tsx`; // virtual, never on disk
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
// Full-size photos other than the open one are held (never answered) until
// released, like a phone on slow data: the neighbours are NOT preloaded.
let held = [];
let hold = true;
beforeAll(async () => {
  if (!HAS_CHROME) return;
  const js = await bundle();
  const candidates = [
    ...new Set(sources("app/components").split(/[\s"'`]+/)),
  ].filter(Boolean);
  const style = await css(candidates);
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    const img = /^\/img\/(\w+)\/([\w-]+)/.exec(url);
    if (img) {
      const send = () => {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        res.end(SVG);
      };
      if (hold && img[2].startsWith("view") && img[1] !== "p3") held.push(send);
      else send();
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
afterAll(() => {
  for (const s of held) s();
  server?.close();
});

async function open() {
  held = [];
  hold = true;
  const { ch, list } = await launchChrome();
  const cdp = await connectCdp(list);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 412,
    height: 800,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
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
  );
  // Records every animation start (by element role) and, each frame, the
  // transforms of the photo layers.
  await cdp.evaluate(`
    window.__anims = [];
    const a = Element.prototype.animate;
    Element.prototype.animate = function (...x) {
      window.__anims.push(this.getAttribute("data-testid") + (this.hasAttribute("data-lb-leaving") ? ":leaving" : ""));
      return a.apply(this, x);
    };
    window.__frames = { leaving: [], arriving: [] };
    const tick = () => {
      const l = document.querySelector("[data-lb-leaving]");
      const n = document.querySelector("[data-testid=lightbox-img]");
      if (l) window.__frames.leaving.push(getComputedStyle(l).transform);
      if (n && document.querySelector("[data-lb-leaving]"))
        window.__frames.arriving.push(getComputedStyle(n).transform);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    true;
  `);
  const touch = (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  const swipe = async (from, to) => {
    await touch("touchStart", from, 400);
    const step = to > from ? 12 : -12;
    for (let x = from; (to - x) * step > 0; x += step)
      await touch("touchMove", x, 400);
    return () => touch("touchEnd");
  };
  const tap = async (x, y) => {
    await touch("touchStart", x, y);
    await touch("touchEnd");
  };
  const index = () => cdp.evaluate("window.__state.index");
  const settled = (what) =>
    until(
      () =>
        cdp.evaluate(
          `!document.querySelector("[data-lb-leaving]") && document.getAnimations().length === 0`,
        ),
      what,
    );
  return { ch, cdp, swipe, tap, index, settled };
}

const distinct = (a) => new Set(a).size;

describe.skipIf(!HAS_CHROME)(
  "T6.41 lightbox slide with an unloaded neighbour (DPR 3 phone)",
  () => {
    for (const [name, from, to, expected] of [
      ["left (next)", 330, 90, 4],
      ["right (previous)", 90, 330, 2],
    ]) {
      it(`swipe ${name}: neighbour shows under the finger, then both slide`, async () => {
        const { ch, cdp, swipe, index, settled } = await open();
        try {
          const end = await swipe(from, to);
          // Under the finger: the neighbour is drawn (placeholder), not blank.
          await until(
            () =>
              cdp.evaluate(
                `!!document.querySelector("[data-testid=lightbox-neighbour]")`,
              ),
            "neighbour drawn during the drag",
          );
          await end();
          await until(async () => (await index()) === expected, "navigated");
          await until(
            async () => (await cdp.evaluate("window.__anims")).length >= 2,
            "animations started",
          );
          const anims = await cdp.evaluate("window.__anims");
          expect(anims).toContain("lightbox-leaving:leaving");
          expect(anims).toContain("lightbox-img");
          await settled("slide end");
          const f = await cdp.evaluate("window.__frames");
          expect(distinct(f.leaving)).toBeGreaterThanOrEqual(3);
          expect(distinct(f.arriving)).toBeGreaterThanOrEqual(3);
          // Never a blank stage: a thumbnail stands in while the photo loads.
          const shown = await cdp.evaluate(
            `[...document.querySelectorAll("[data-testid=lightbox-placeholder]")].map((e) => e.src)`,
          );
          expect(shown.length).toBe(1);
          expect(shown[0]).toContain("/thumb");
        } finally {
          cdp.close();
          ch.kill();
        }
      }, 60000);
    }

    it("tapping the edge zones and the arrows slides too", async () => {
      const { ch, cdp, tap, index, settled } = await open();
      try {
        await tap(390, 220);
        await until(async () => (await index()) === 4, "next by edge tap");
        await until(
          async () => (await cdp.evaluate("window.__anims")).length >= 2,
          "edge tap animates",
        );
        await settled("edge slide end");
        const before = (await cdp.evaluate("window.__anims")).length;
        await cdp.evaluate(
          `document.querySelector("button[aria-label=Previous]").click()`,
        );
        await until(async () => (await index()) === 3, "previous by arrow");
        await until(
          async () =>
            (await cdp.evaluate("window.__anims")).length >= before + 2,
          "arrow animates",
        );
        await settled("arrow slide end");
      } finally {
        cdp.close();
        ch.kill();
      }
    }, 60000);

    it("rapid swipes leave no stuck state and the photo crossfades in once loaded", async () => {
      const { ch, cdp, swipe, index, settled } = await open();
      try {
        for (let k = 0; k < 3; k++) {
          const end = await swipe(330, 90);
          await end();
        }
        await until(async () => (await index()) === 6, "three photos on");
        await settled("rapid slides end");
        expect(
          await cdp.evaluate(
            `getComputedStyle(document.querySelector("[data-testid=lightbox-img]")).transform`,
          ),
        ).toBe("none");
        // Release the held photos: the full image loads and becomes visible.
        hold = false;
        for (const s of held.splice(0)) s();
        await until(
          () =>
            cdp.evaluate(
              `getComputedStyle(document.querySelector("[data-testid=lightbox-img]")).opacity === "1"`,
            ),
          "full photo visible",
        );
      } finally {
        cdp.close();
        ch.kill();
      }
    }, 60000);
  },
);
