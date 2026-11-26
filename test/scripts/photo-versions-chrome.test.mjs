import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";
import { bundlePage } from "../support/bundle-page.mjs";

// T6.53c in real Chrome: the real GalleryView of a versioned album (round
// badge on the grid, "Ronda N" on the album header, the history in the
// lightbox) at phone and desktop widths, in both languages.
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

let file;
const page = async () =>
  (file ??= await bundlePage("test/support/versions-entry.tsx"));

async function open(width, lang, steps) {
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
    await cdp.send("Page.navigate", { url: `file://${await page()}#${lang}` });
    await until(
      () => cdp.evaluate("!!document.querySelector('[data-testid=open-0]')"),
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
  const s = getComputedStyle(el);
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, w: r.width, h: r.height,
    text: el.textContent.trim(), visible: s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0,
    pe: s.pointerEvents };
})()`;

describe.skipIf(!HAS_CHROME)("T6.53c versioned album in real Chrome", () => {
  for (const width of [390, 1280]) {
    describe(`${width}px`, () => {
      it("grid badge: only the tile of a new version, inside its tile, never in the way of a click", async () => {
        await open(width, "es", async (cdp) => {
          await cdp.evaluate(
            "document.querySelector('[data-testid=tile-0]').scrollIntoView({ block: 'center' })",
          );
          const badge = await cdp.evaluate(rect("[data-testid=new-0]"));
          expect(badge.text).toBe("Nuevo en esta ronda");
          expect(badge.visible).toBe(true);
          expect(badge.pe).toBe("none");
          const tile = await cdp.evaluate(rect("[data-testid=tile-0]"));
          expect(badge.left).toBeGreaterThanOrEqual(tile.left);
          expect(badge.right).toBeLessThanOrEqual(tile.right + 0.5);
          expect(badge.top).toBeGreaterThanOrEqual(tile.top);
          expect(badge.bottom).toBeLessThanOrEqual(tile.bottom);
          // Only p0 is in the newest round.
          expect(
            await cdp.evaluate(
              "document.querySelectorAll('[data-testid^=new-]').length",
            ),
          ).toBe(1);
          // A click on the badge's own spot opens the lightbox (it is not an obstacle).
          const hit = await cdp.evaluate(
            `document.elementFromPoint(${(badge.left + badge.right) / 2}, ${(badge.top + badge.bottom) / 2}).closest('[data-testid]')?.dataset.testid`,
          );
          expect(hit).toBe("open-0");
        });
      }, 60000);

      it("album header: Ronda 3 under the date, fully on screen", async () => {
        await open(width, "es", async (cdp) => {
          const round = await cdp.evaluate(rect("[data-testid=cover-round]"));
          expect(round.text).toBe("Ronda 3");
          expect(round.visible).toBe(true);
          expect(round.left).toBeGreaterThanOrEqual(0);
          expect(round.right).toBeLessThanOrEqual(width);
          const title = await cdp.evaluate(rect("h1"));
          expect(round.top).toBeGreaterThan(title.bottom);
        });
      }, 60000);

      it("lightbox: version caption, history list newest first, previews by ?ver=, panel on screen", async () => {
        await open(width, "es", async (cdp) => {
          await cdp.evaluate(
            "document.querySelector('[data-testid=open-0]').click()",
          );
          await until(
            () =>
              cdp.evaluate(
                "!!document.querySelector('[data-testid=lightbox-versions]')",
              ),
            "version caption",
          );
          expect(
            (await cdp.evaluate(rect("[data-testid=lightbox-version]"))).text,
          ).toBe("Versión 3 · Ronda 3");
          expect(
            await cdp.evaluate(
              "!!document.querySelector('[data-testid=versions-panel]')",
            ),
          ).toBe(false);
          await cdp.evaluate(
            "document.querySelector('[data-testid=versions-toggle]').click()",
          );
          await until(
            () =>
              cdp.evaluate(
                "!!document.querySelector('[data-testid=versions-panel]')",
              ),
            "panel",
          );
          const panel = await cdp.evaluate(
            rect("[data-testid=versions-panel]"),
          );
          expect(panel.left).toBeGreaterThanOrEqual(0);
          expect(panel.right).toBeLessThanOrEqual(width);
          expect(panel.top).toBeGreaterThanOrEqual(0);
          expect(panel.bottom).toBeLessThanOrEqual(800);
          const order = await cdp.evaluate(
            "[...document.querySelectorAll('[data-testid^=version-]')].map((e) => [...e.querySelectorAll('span span')].map((x) => x.textContent).join(' '))",
          );
          expect(order).toEqual([
            "Versión 3 · Actual Ronda 3 · 09/03/2026",
            "Versión 2 Ronda 2 · 05/03/2026",
            "Versión 1 Entrega inicial · 01/03/2026",
          ]);
          // Every control of the panel is really clickable (no nav zone or bar on top).
          const covered = await cdp.evaluate(`[
            ...document.querySelectorAll(
              "[data-testid^=version-], [data-testid=versions-toggle]",
            ),
          ].filter((e) => {
            const r = e.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !e.contains(hit);
          }).map((e) => e.dataset.testid)`);
          expect(covered).toEqual([]);
          // The preview follows the pick and goes through /img with the version number.
          expect(
            await cdp.evaluate(
              "document.querySelector('[data-testid=versions-preview]').getAttribute('src')",
            ),
          ).toBe("/img/p0/view-sm?ver=3&v=t3");
          await cdp.evaluate(
            "document.querySelector('[data-testid=version-1]').click()",
          );
          await until(
            async () =>
              (await cdp.evaluate(
                "document.querySelector('[data-testid=versions-preview]').getAttribute('src')",
              )) === "/img/p0/view-sm?ver=1&v=t1",
            "preview of v1",
          );
          expect(
            await cdp.evaluate(
              "document.querySelector('[data-testid=version-1]').getAttribute('aria-pressed')",
            ),
          ).toBe("true");
          // Nothing in the panel downloads, and the dialog is still open.
          expect(
            await cdp.evaluate(
              "document.querySelectorAll('[data-testid=versions-panel] a, [data-testid=versions-panel] [download]').length",
            ),
          ).toBe(0);
          expect(
            await cdp.evaluate("!!document.querySelector('[role=dialog]')"),
          ).toBe(true);
        });
      }, 60000);
    });
  }

  it("English copy and a photo without history shows nothing extra", async () => {
    await open(1280, "en", async (cdp) => {
      expect((await cdp.evaluate(rect("[data-testid=new-0]"))).text).toBe(
        "New in this round",
      );
      expect((await cdp.evaluate(rect("[data-testid=cover-round]"))).text).toBe(
        "Round 3",
      );
      await cdp.evaluate(
        "document.querySelector('[data-testid=open-2]').click()",
      );
      await until(
        () => cdp.evaluate("!!document.querySelector('[role=dialog]')"),
        "lightbox",
      );
      expect(
        await cdp.evaluate(
          "!!document.querySelector('[data-testid=lightbox-versions]')",
        ),
      ).toBe(false);
    });
  }, 60000);

  it("a photo with two versions but not in the newest round: caption and history, no badge", async () => {
    await open(1280, "en", async (cdp) => {
      expect(
        await cdp.evaluate("!!document.querySelector('[data-testid=new-1]')"),
      ).toBe(false);
      await cdp.evaluate(
        "document.querySelector('[data-testid=open-1]').click()",
      );
      await until(
        () =>
          cdp.evaluate(
            "!!document.querySelector('[data-testid=lightbox-versions]')",
          ),
        "caption",
      );
      expect(
        (await cdp.evaluate(rect("[data-testid=lightbox-version]"))).text,
      ).toBe("Version 2 · Round 2");
      expect(
        (await cdp.evaluate(rect("[data-testid=versions-toggle]"))).text,
      ).toBe("History (2)");
    });
  }, 60000);
});
