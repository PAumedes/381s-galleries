import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";
import { bundlePage } from "../support/bundle-page.mjs";

// T6.53d2 in real Chrome: the client page shows an all-TIFF album as a
// title-only tile with the "TIFF delivery" caption, inside the 4:3 frame like
// the PIN tile, no image, the long title wrapping inside its column.
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

let file;
const page = async () =>
  (file ??= await bundlePage("test/support/client-tiff-entry.tsx"));

async function open(width, hash, steps) {
  const { ch, list } = await launchChrome();
  try {
    const cdp = await connectCdp(list);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: `file://${await page()}#${hash}` });
    await until(
      () => cdp.evaluate("!!document.querySelector('a[href=\"/acme/boda\"]')"),
      "client page",
    );
    return await steps(cdp);
  } finally {
    ch.kill();
  }
}

const tile = (slug) => `(() => {
  const a = document.querySelector('a[href="/acme/${slug}"]');
  const box = a.firstElementChild.getBoundingClientRect();
  const r = a.getBoundingClientRect();
  const cap = [...a.firstElementChild.children].map((c) => c.getBoundingClientRect());
  return { w: box.width, h: box.height, aw: r.width, sw: a.scrollWidth, cw: a.clientWidth,
    img: !!a.querySelector('img'), svg: !!a.querySelector('svg'),
    text: a.innerText, capInside: cap.every((c) => c.left >= box.left - 0.5 && c.right <= box.right + 0.5) };
})()`;

describe.skipIf(!HAS_CHROME)(
  "T6.53d2 TIFF delivery tile in real Chrome",
  () => {
    for (const width of [390, 1280]) {
      it(`${width}px: caption in a 4:3 frame, title and date below, no image or lock, long title contained`, async () => {
        await open(width, "es", async (cdp) => {
          const t = await cdp.evaluate(tile("boda"));
          expect(Math.round((t.w / t.h) * 100)).toBe(133);
          expect(t.img).toBe(false);
          expect(t.svg).toBe(false);
          expect(t.capInside).toBe(true);
          expect(t.text).toContain("ENTREGA EN TIFF");
          expect(t.text).toContain("Boda Ana");
          // the PIN tile keeps its lock and the same frame size
          const pin = await cdp.evaluate(tile("privado"));
          expect(pin.svg).toBe(true);
          expect(Math.round(pin.w)).toBe(Math.round(t.w));
          const long = await cdp.evaluate(tile("largo"));
          expect(long.sw).toBeLessThanOrEqual(long.cw);
          expect(long.text).toContain("ENTREGA EN TIFF");
        });
      });
    }

    it("English caption", async () => {
      await open(390, "en", async (cdp) => {
        const t = await cdp.evaluate(tile("boda"));
        expect(t.text).toContain("TIFF DELIVERY");
      });
    });
  },
);
