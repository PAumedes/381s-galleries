import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";
import { bundlePage } from "../support/bundle-page.mjs";

// T6.54 (1): the client filter of the album list sits in the search row with
// the same control styling, and stacks full width under it on phones.
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

const MEASURE = `(() => {
  const r = (e) => e.getBoundingClientRect();
  const q = document.querySelector('input[type=search]');
  const sel = document.querySelector('select');
  const btn = document.querySelector('[role=search] button');
  const cs = (e) => getComputedStyle(e);
  const chips = document.querySelector('nav');
  return {
    iw: innerWidth,
    q: { top: r(q).top, h: r(q).height, left: r(q).left, right: r(q).right, w: r(q).width },
    sel: { top: r(sel).top, h: r(sel).height, left: r(sel).left, right: r(sel).right, w: r(sel).width,
      fs: parseFloat(cs(sel).fontSize), border: cs(sel).borderTopColor + cs(sel).borderTopWidth, bg: cs(sel).backgroundColor,
      labelled: !!(sel.getAttribute('aria-label') || sel.labels?.length), visibleLabel: [...(sel.labels ?? [])].some((l) => r(l).height > 0 && cs(l).position !== 'absolute') },
    qStyle: { fs: parseFloat(cs(q).fontSize), border: cs(q).borderTopColor + cs(q).borderTopWidth, bg: cs(q).backgroundColor },
    btnH: r(btn).height,
    chipsTop: r(chips).top,
    docOverflow: document.documentElement.scrollWidth > innerWidth,
  };
})()`;

async function measure(file, width, lang) {
  const { ch, list } = await launchChrome();
  try {
    const cdp = await connectCdp(list);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: `file://${file}#${lang}` });
    await until(
      () => cdp.evaluate("!!document.querySelector('select')"),
      "list",
    );
    return await cdp.evaluate(MEASURE);
  } finally {
    ch.kill();
  }
}

describe.skipIf(!HAS_CHROME)("T6.54 album list client filter", () => {
  let file;
  const page = async () =>
    (file ??= await bundlePage("test/support/gallery-list-entry.tsx", {
      bodyAttrs: "data-admin",
    }));
  for (const lang of ["es", "en"])
    for (const width of [320, 360, 412]) {
      it(`${lang} ${width}px: full width under the search, same height/border/font as the search box, no own label line`, async () => {
        const m = await measure(await page(), width, lang);
        expect(m.docOverflow).toBe(false);
        expect(m.sel.right).toBeLessThanOrEqual(m.iw);
        expect(m.sel.top).toBeGreaterThan(m.q.top + m.q.h - 1);
        expect(m.sel.top - (m.q.top + m.q.h)).toBeLessThan(16);
        expect(m.sel.w).toBeGreaterThan(m.iw - 16 - 16 - 2);
        expect(Math.abs(m.sel.h - m.q.h)).toBeLessThan(1);
        expect(m.sel.h).toBeGreaterThanOrEqual(43.5);
        expect(m.sel.fs).toBeGreaterThanOrEqual(16);
        expect(m.sel.border).toBe(m.qStyle.border);
        expect(m.sel.bg).toBe(m.qStyle.bg);
        expect(m.sel.labelled).toBe(true);
        expect(m.sel.visibleLabel).toBe(false);
        expect(m.chipsTop).toBeGreaterThan(m.sel.top + m.sel.h - 1);
      }, 60000);
    }
  for (const width of [768, 1280])
    it(`${width}px: select shares the search row, aligned and the same height`, async () => {
      const m = await measure(await page(), width, "es");
      expect(Math.abs(m.sel.top - m.q.top)).toBeLessThan(2);
      expect(Math.abs(m.sel.h - m.q.h)).toBeLessThan(1);
      expect(m.sel.left).toBeGreaterThan(m.q.right);
      expect(m.sel.right).toBeLessThanOrEqual(m.iw);
      expect(m.sel.border).toBe(m.qStyle.border);
      expect(m.chipsTop).toBeGreaterThan(m.sel.top + m.sel.h - 1);
    }, 60000);
});
