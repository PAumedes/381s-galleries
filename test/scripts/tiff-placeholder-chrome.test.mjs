import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";
import { bundlePage } from "../support/bundle-page.mjs";

// T6.53d in real Chrome: the real GalleryView with TIFF-only photos between
// ordinary ones: the placeholder card in the grid and in the lightbox, the
// download sheet behind its button, Prueba without any download.
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

let file;
const page = async () =>
  (file ??= await bundlePage("test/support/tiff-entry.tsx"));

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
      () => cdp.evaluate("!!document.querySelector('[data-testid=open-1]')"),
      "grid",
    );
    return await steps(cdp);
  } finally {
    ch.kill();
  }
}

const rect = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, w: r.width, h: r.height,
    text: el.textContent.trim(), sw: el.scrollWidth, cw: el.clientWidth };
})()`;
const exists = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`;
/** True when the element's centre really hits the element (nothing on top of it). */
const hits = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  const r = el.getBoundingClientRect();
  return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
})()`;

describe.skipIf(!HAS_CHROME)("T6.53d TIFF placeholder in real Chrome", () => {
  for (const width of [390, 1280]) {
    describe(`${width}px`, () => {
      it("grid: the card sits inside a 3:2 tile, text and name fit, no image, download button inside the tile and clickable", async () => {
        await open(width, "es", async (cdp) => {
          await cdp.evaluate(
            "document.querySelector('[data-testid=tile-1]').scrollIntoView({ block: 'center' })",
          );
          const tile = await cdp.evaluate(rect("[data-testid=tile-1]"));
          expect(Math.round((tile.w / tile.h) * 10)).toBe(15);
          expect(
            await cdp.evaluate(
              "document.querySelector('[data-testid=tile-1] img')",
            ),
          ).toBeNull();
          const text = await cdp.evaluate(
            "document.querySelector('[data-testid=open-1]').innerText",
          );
          expect(text).toContain("Vista previa no disponible");
          expect(text).toContain("312 MB");
          // The long name is cut with an ellipsis inside the tile, never wider than it.
          const inside =
            await cdp.evaluate(`[...document.querySelectorAll('[data-testid=tile-1] *')].filter((e) => {
            const r = e.getBoundingClientRect();
            const t = document.querySelector('[data-testid=tile-1]').getBoundingClientRect();
            return r.width > 0 && (r.left < t.left - 0.5 || r.right > t.right + 0.5 || r.top < t.top - 0.5 || r.bottom > t.bottom + 0.5);
          }).length`);
          expect(inside).toBe(0);
          const btn =
            '[data-testid=tile-1] button[aria-label="Descargar original"]';
          const b = await cdp.evaluate(rect(btn));
          expect(b.w).toBeGreaterThanOrEqual(44);
          expect(b.h).toBeGreaterThanOrEqual(44);
          expect(await cdp.evaluate(hits(btn))).toBe(true);
          // The unknown size is not printed as a number.
          expect(
            await cdp.evaluate(
              "document.querySelector('[data-testid=open-3]').innerText",
            ),
          ).not.toMatch(/MB/);
          // Ordinary tiles keep their image.
          expect(await cdp.evaluate(exists("[data-testid=tile-0] img"))).toBe(
            true,
          );
        });
      }, 60000);

      it("download button opens the sheet with the TIFF original and does not open the lightbox", async () => {
        await open(width, "es", async (cdp) => {
          await cdp.evaluate(
            "document.querySelector('[data-testid=tile-1] button[aria-label=\"Descargar original\"]').click()",
          );
          await until(
            () =>
              cdp.evaluate(
                "!!document.querySelector('[role=dialog][aria-label=\"Descargar foto\"]')",
              ),
            "sheet",
          );
          const labels = await cdp.evaluate(
            "[...document.querySelectorAll('[role=dialog] li button')].map((b) => b.textContent)",
          );
          expect(labels).toEqual(["Original TIFF · 312 MB"]);
          expect(
            await cdp.evaluate(exists("[data-testid=lightbox-preview-card]")),
          ).toBe(false);
        });
      }, 60000);

      it("lightbox: the card is centred on screen with its text, size and download button; no image is requested for it", async () => {
        await open(width, "es", async (cdp) => {
          await cdp.evaluate(
            "document.querySelector('[data-testid=open-1]').click()",
          );
          await until(
            () => cdp.evaluate(exists("[data-testid=lightbox-preview-card]")),
            "card",
          );
          const card = await cdp.evaluate(
            rect("[data-testid=lightbox-preview-card]"),
          );
          expect(card.left).toBeGreaterThanOrEqual(0);
          expect(card.right).toBeLessThanOrEqual(width);
          expect(
            Math.abs((card.left + card.right) / 2 - width / 2),
          ).toBeLessThan(2);
          expect(card.top).toBeGreaterThan(40);
          expect(card.bottom).toBeLessThan(800);
          expect(card.text).toContain("Vista previa no disponible");
          expect(card.text).toContain("312 MB");
          expect(card.sw).toBeLessThanOrEqual(card.cw + 1);
          expect(await cdp.evaluate(exists("[data-testid=lightbox-img]"))).toBe(
            false,
          );
          expect(
            await cdp.evaluate(
              "[...document.images].filter((i) => i.src.includes('/img/t1/')).length",
            ),
          ).toBe(0);
          const btn = "[data-testid=lightbox-preview-card] button";
          const b = await cdp.evaluate(rect(btn));
          expect(b.h).toBeGreaterThanOrEqual(44);
          expect(await cdp.evaluate(hits(btn))).toBe(true);
          // The sheet opens from the card button, over the still open lightbox.
          await cdp.evaluate(
            `document.querySelector(${JSON.stringify(btn)}).click()`,
          );
          await until(
            () =>
              cdp.evaluate(
                "!!document.querySelector('[role=dialog][aria-label=\"Descargar foto\"]')",
              ),
            "sheet",
          );
        });
      }, 60000);

      it("lightbox: next / previous walk across the cards without losing the layout", async () => {
        await open(width, "es", async (cdp) => {
          await cdp.evaluate(
            "document.querySelector('[data-testid=open-0]').click()",
          );
          // /img does not exist under file://: the first photo may sit in its error state.
          const counter = (n) =>
            until(
              () =>
                cdp.evaluate(
                  `document.querySelector('[role=dialog]')?.innerText.includes('${n} / 4')`,
                ),
              `photo ${n}`,
            );
          const key = (k) =>
            cdp.evaluate(
              `document.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true }))`,
            );
          await counter(1);
          expect(
            await cdp.evaluate(exists("[data-testid=lightbox-preview-card]")),
          ).toBe(false);
          await key("ArrowRight");
          await counter(2);
          await until(
            () => cdp.evaluate(exists("[data-testid=lightbox-preview-card]")),
            "card",
          );
          expect(await cdp.evaluate(exists("[data-testid=lightbox-img]"))).toBe(
            false,
          );
          expect(
            await cdp.evaluate(exists("[data-testid=lightbox-prev]")),
          ).toBe(false);
          await key("ArrowRight");
          await counter(3);
          await until(
            () =>
              cdp.evaluate(
                "!document.querySelector('[data-testid=lightbox-preview-card]')",
              ),
            "card gone",
          );
          await key("ArrowRight");
          await counter(4);
          await until(
            () => cdp.evaluate(exists("[data-testid=lightbox-preview-card]")),
            "last card",
          );
          expect(
            await cdp.evaluate(
              "document.querySelector('[data-testid=lightbox-preview-card]').innerText",
            ),
          ).not.toMatch(/MB/);
          await key("ArrowLeft");
          await counter(3);
          await key("ArrowLeft");
          await counter(2);
          await until(
            () => cdp.evaluate(exists("[data-testid=lightbox-preview-card]")),
            "card again",
          );
          expect(
            await cdp.evaluate(
              "document.querySelector('[data-testid=lightbox-preview-card]').innerText",
            ),
          ).toContain("312 MB");
        });
      }, 60000);
    });
  }

  it("Prueba: the card shows with no download button anywhere (grid and lightbox)", async () => {
    await open(1280, "es,prueba", async (cdp) => {
      expect(
        await cdp.evaluate(
          exists(
            '[data-testid=tile-1] button[aria-label="Descargar original"]',
          ),
        ),
      ).toBe(false);
      await cdp.evaluate(
        "document.querySelector('[data-testid=open-1]').click()",
      );
      await until(
        () => cdp.evaluate(exists("[data-testid=lightbox-preview-card]")),
        "card",
      );
      expect(
        await cdp.evaluate(
          exists("[data-testid=lightbox-preview-card] button"),
        ),
      ).toBe(false);
      expect(
        await cdp.evaluate(
          exists('[role=dialog] button[aria-label="Descargar"]'),
        ),
      ).toBe(false);
    });
  }, 60000);

  it("English copy", async () => {
    await open(1280, "en", async (cdp) => {
      const text = await cdp.evaluate(
        "document.querySelector('[data-testid=open-3]').innerText",
      );
      expect(text).toContain("Preview not available");
      expect(text.toLowerCase()).toContain("tiff file");
      expect(
        await cdp.evaluate(
          exists('[data-testid=tile-1] button[aria-label="Download original"]'),
        ),
      ).toBe(true);
    });
  }, 60000);
});
