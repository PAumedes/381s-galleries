import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { bundlePage } from "../support/bundle-page.mjs";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";

// T6.57 in real Chrome: the real HelpView at a phone (390) and a desktop (1280)
// width. Native details open by tap and by keyboard, steps show numbers (the
// CSS reset removes them unless asked), text is large and has good contrast,
// nothing overflows sideways, anchors scroll to the answer.
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

let file;
const page = async () =>
  (file ??= await bundlePage("test/support/help-entry.tsx", {
    bodyAttrs: "data-admin",
  }));

const browsers = [];
afterAll(() => browsers.forEach((ch) => ch.kill()));

async function open(width, query, steps) {
  const { ch, list } = await launchChrome();
  browsers.push(ch);
  const cdp = await connectCdp(list);
  const phone = width < 768;
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 800,
    deviceScaleFactor: 1,
    mobile: phone,
  });
  if (phone)
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", {
    url: `file://${await page()}${query ? `?${query}` : ""}`,
  });
  await until(
    () => cdp.evaluate("!!document.querySelector('details')"),
    "the help page",
  );
  try {
    return await steps(cdp);
  } finally {
    ch.kill();
  }
}

// Contrast ratio of an element's text colour over its effective background.
const CONTRAST = `(el) => {
  const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const rgba = (s) => { const m = s.match(/[\\d.]+/g).map(Number); return { c: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };
  let bg = [255, 255, 255];
  const stack = []; for (let e = el; e; e = e.parentElement) stack.unshift(getComputedStyle(e).backgroundColor);
  for (const s of stack) { const { c, a } = rgba(s); if (a > 0) bg = c.map((x, i) => x * a + bg[i] * (1 - a)); }
  const fg = rgba(getComputedStyle(el).color).c;
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}`;

describe.skipIf(!HAS_CHROME).each([390, 1280])(
  "T6.57 help page in real Chrome at %ipx",
  (width) => {
    it("fits the screen, lists every question collapsed, with big readable text and good contrast", async () => {
      const r = await open(width, "", (cdp) =>
        cdp.evaluate(`(() => {
          const contrast = ${CONTRAST};
          const s = document.querySelector("summary");
          const sr = s.getBoundingClientRect();
          const h1 = document.querySelector("h1");
          const body = document.querySelector("details p, details li") ;
          const d = document.querySelector("details");
          d.open = true;
          const p = d.querySelector("p, li");
          return {
            overflowX: document.documentElement.scrollWidth - innerWidth,
            details: document.querySelectorAll("details").length,
            openCount: document.querySelectorAll("details[open]").length - 1,
            summaryH: sr.height, summaryFont: parseFloat(getComputedStyle(s).fontSize),
            bodyFont: parseFloat(getComputedStyle(p).fontSize),
            summaryContrast: contrast(s), bodyContrast: contrast(p), h1Contrast: contrast(h1),
            summaryW: sr.width,
            textMax: Math.max(...[...document.querySelectorAll("details p")].map((e) => e.getBoundingClientRect().width)),
          };
        })()`),
      );
      expect(r.overflowX).toBeLessThanOrEqual(0);
      expect(r.details).toBeGreaterThanOrEqual(40);
      expect(r.openCount).toBe(0);
      expect(r.summaryH).toBeGreaterThanOrEqual(44);
      expect(r.summaryFont).toBeGreaterThanOrEqual(17);
      expect(r.bodyFont).toBeGreaterThanOrEqual(16);
      expect(r.summaryContrast).toBeGreaterThanOrEqual(7);
      expect(r.bodyContrast).toBeGreaterThanOrEqual(7);
      expect(r.h1Contrast).toBeGreaterThanOrEqual(7);
      // Lines stay readable on a wide screen (about 70 characters).
      expect(r.textMax).toBeLessThanOrEqual(760);
    }, 60000);

    it("a tap or Enter opens an answer, the numbered steps show their numbers", async () => {
      await open(width, "", async (cdp) => {
        await cdp.evaluate(
          "document.getElementById('albums-publish').querySelector('summary').click()",
        );
        await until(
          () => cdp.evaluate("document.getElementById('albums-publish').open"),
          "tap opens",
        );
        const o = await cdp.evaluate(`(() => {
          const ol = document.getElementById('albums-publish').querySelector('ol');
          const li = ol.querySelector('li');
          const r = li.getBoundingClientRect();
          return { type: getComputedStyle(ol).listStyleType, h: r.height, vis: r.height > 0 && r.right <= innerWidth };
        })()`);
        expect(o.type).toBe("decimal");
        expect(o.vis).toBe(true);
        // Keyboard: focus another summary, press Enter (real key events).
        await cdp.evaluate(
          "document.getElementById('albums-create').querySelector('summary').focus()",
        );
        for (const type of ["keyDown", "keyUp"])
          await cdp.send("Input.dispatchKeyEvent", {
            type,
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
            ...(type === "keyDown" ? { text: "\r" } : {}),
          });
        await until(
          () => cdp.evaluate("document.getElementById('albums-create').open"),
          "Enter opens",
        );
      });
    }, 60000);

    it("typing in the search box narrows the list and opens the matches", async () => {
      await open(width, "", async (cdp) => {
        await cdp.evaluate("document.querySelector('[type=search]').focus()");
        await cdp.send("Input.insertText", { text: "PIN" });
        const n = await until(async () => {
          const c = await cdp.evaluate(
            "document.querySelectorAll('details').length",
          );
          return c > 0 && c < 40 ? c : 0;
        }, "filtered list");
        expect(n).toBeGreaterThan(0);
        expect(
          await cdp.evaluate(
            "[...document.querySelectorAll('details')].every((d) => d.open)",
          ),
        ).toBe(true);
        expect(
          await cdp.evaluate(
            "document.documentElement.scrollWidth <= innerWidth",
          ),
        ).toBe(true);
      });
    }, 60000);

    it("an anchor opens its answer and scrolls it into view", async () => {
      await open(width, "at=trouble-pin", async (cdp) => {
        const v = await until(
          () =>
            cdp.evaluate(`(() => {
              const d = document.getElementById('trouble-pin');
              const r = d.querySelector('summary').getBoundingClientRect();
              return d.open && r.top >= 0 && r.top < innerHeight ? Math.round(r.top) : null;
            })()`),
          "anchor opened and visible",
        );
        expect(v).toBeGreaterThanOrEqual(0);
      });
    }, 60000);

    it("English at the same width does not overflow either", async () => {
      const over = await open(width, "lang=en", (cdp) =>
        cdp.evaluate(
          "document.querySelector('h1').textContent + '|' + (document.documentElement.scrollWidth - innerWidth)",
        ),
      );
      const [title, x] = over.split("|");
      expect(title).toBe("Help");
      expect(Number(x)).toBeLessThanOrEqual(0);
    }, 60000);
  },
);

describe("T6.57 production CSS carries the help classes", () => {
  // After `pnpm build`: the classes used by the help page are in the built sheet.
  const dir = "build/client/assets";
  const built = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".css"))
    : [];
  it.skipIf(built.length === 0)(
    "has list-decimal, text-lg and the details styles",
    () => {
      const css = built
        .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
        .join("\n");
      for (const c of [".list-decimal", ".list-disc", ".text-lg"])
        expect(css, c).toContain(c);
    },
  );
});
