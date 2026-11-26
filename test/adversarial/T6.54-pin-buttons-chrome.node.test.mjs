import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";
import { bundlePage } from "../support/bundle-page.mjs";

// T6.54 (2): the "change PIN" / "remove PIN" buttons share a row from sm up
// and stack full width on phones (real Chrome, the real client edit view).
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

const MEASURE = `(() => {
  const sec = document.querySelector('form:has(input[name=pin])').closest('section');
  const [a, b] = [...sec.querySelectorAll('button')].map((e) => e.getBoundingClientRect());
  const inner = sec.getBoundingClientRect();
  return { aTop: a.top, bTop: b.top, aLeft: a.left, bLeft: b.left, aRight: a.right, bRight: b.right,
    aW: a.width, bW: b.width, secW: inner.width, n: sec.querySelectorAll('button').length };
})()`;

async function layoutAt(file, width) {
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
    await cdp.send("Page.navigate", { url: `file://${file}#es` });
    await until(
      () =>
        cdp.evaluate("!!document.querySelector('form:has(input[name=pin])')"),
      "pin form",
    );
    return await cdp.evaluate(MEASURE);
  } finally {
    ch.kill();
  }
}

const VIEWS = {
  "client edit view": "test/support/client-pin-entry.tsx",
  "album editor PinSection": "test/support/album-pin-entry.tsx",
};
const files = {};

describe.skipIf(!HAS_CHROME)("T6.54 PIN buttons layout", () => {
  for (const [name, entry] of Object.entries(VIEWS)) {
    const page = async () =>
      (files[entry] ??= await bundlePage(entry, { bodyAttrs: "data-admin" }));
    it(`${name}, phones (360px): stacked, each button as wide as the section`, async () => {
      const m = await layoutAt(await page(), 360);
      expect(m.n).toBe(2);
      expect(m.bTop).toBeGreaterThan(m.aTop + 20);
      expect(Math.abs(m.aW - m.bW)).toBeLessThan(1);
      expect(m.aW).toBeGreaterThan(m.secW - 40);
    }, 60000);
    for (const width of [640, 768, 1280])
      it(`${name}, ${width}px: side by side, content width, with a gap`, async () => {
        const m = await layoutAt(await page(), width);
        expect(Math.abs(m.aTop - m.bTop)).toBeLessThan(2);
        expect(m.bLeft).toBeGreaterThan(m.aRight + 4);
        expect(m.aW).toBeLessThan(m.secW / 2);
        expect(m.bW).toBeLessThan(m.secW / 2);
      }, 60000);
  }
});
