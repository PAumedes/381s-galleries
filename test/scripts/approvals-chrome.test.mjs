import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";
import { bundlePage } from "../support/bundle-page.mjs";

// T6.53f in real Chrome: the real GalleryView of a versioned album. Approve and
// un-approve (optimistic, real revert on a refused POST), a new version
// re-opens the photo, no UI at all when versioning is off, and layout at phone
// and desktop width. The server is faked in the page (test/support/approvals-entry.tsx).
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

let file;
const page = async () =>
  (file ??= await bundlePage("test/support/approvals-entry.tsx"));

async function open(width, hash, steps, { lightbox = true } = {}) {
  const { ch, list } = await launchChrome();
  try {
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
    await cdp.send("Page.navigate", { url: `file://${await page()}#${hash}` });
    await until(
      () => cdp.evaluate("!!document.querySelector('[data-testid=open-0]')"),
      "grid",
    );
    if (lightbox) {
      await cdp.evaluate(
        "document.querySelector('[data-testid=open-0]').click()",
      );
      await until(
        () => cdp.evaluate("!!document.querySelector('[role=dialog]')"),
        "lightbox",
      );
    }
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
    text: el.textContent.trim() };
})()`;
const overlap = (a, b) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const text = (cdp, sel) =>
  cdp.evaluate(
    `document.querySelector(${JSON.stringify(sel)})?.textContent.trim() ?? null`,
  );
const pressed = (cdp) =>
  cdp.evaluate(
    "document.querySelector('[data-testid=approve]')?.getAttribute('aria-pressed')",
  );
const posts = (cdp) => cdp.evaluate("JSON.stringify(window.__posts)");
const mouse = (cdp, type, x, y) =>
  cdp.send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: 1,
  });
const touch = (cdp, type, x, y) =>
  cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : [{ x, y }],
  });
/** A real click/tap at the centre of the element (what a visitor does). */
async function press(cdp, width, sel) {
  const r = await cdp.evaluate(rect(sel));
  const x = r.left + r.w / 2;
  const y = r.top + r.h / 2;
  // Whatever is on top at that point must be the button itself.
  expect(
    await cdp.evaluate(
      `document.elementFromPoint(${x}, ${y})?.closest('[data-testid=approve]') !== null`,
    ),
  ).toBe(true);
  if (width < 768) {
    await touch(cdp, "touchStart", x, y);
    await touch(cdp, "touchEnd");
  } else {
    await mouse(cdp, "mousePressed", x, y);
    await mouse(cdp, "mouseReleased", x, y);
  }
}

describe.skipIf(!HAS_CHROME)("T6.53f approvals in real Chrome", () => {
  for (const width of [390, 1280]) {
    describe(`${width}px`, () => {
      it("approve then un-approve: pressed state, badge in the grid, one POST each, and the dialog stays open", async () => {
        await open(width, "en", async (cdp) => {
          const b = await cdp.evaluate(rect("[data-testid=approve]"));
          expect(b.text).toBe("Approve v2");
          expect(await pressed(cdp)).toBe("false");
          await press(cdp, width, "[data-testid=approve]");
          await until(async () => (await pressed(cdp)) === "true", "pressed");
          expect(await text(cdp, "[data-testid=approve]")).toBe(
            "Approved in v2",
          );
          expect(await text(cdp, "[data-testid=approve-live]")).toBe(
            "Version 2 approved",
          );
          expect(await posts(cdp)).toBe(
            JSON.stringify([{ photoId: "p0", version: 2, on: true }]),
          );
          // Still the lightbox: tapping the button never closed it.
          expect(
            await cdp.evaluate("!!document.querySelector('[role=dialog]')"),
          ).toBe(true);
          // Approved state is visibly different (white fill, dark text).
          // (the button eases its colours, so poll until the transition ends)
          const colours = () =>
            cdp.evaluate(
              "(() => { const s = getComputedStyle(document.querySelector('[data-testid=approve]')); return s.backgroundColor + '|' + s.color; })()",
            );
          await until(
            async () => (await colours()) === "rgb(255, 255, 255)|rgb(0, 0, 0)",
            "white fill with dark text",
          );
          await press(cdp, width, "[data-testid=approve]");
          await until(
            async () => (await pressed(cdp)) === "false",
            "unpressed",
          );
          expect(await text(cdp, "[data-testid=approve-live]")).toBe(
            "Approval of version 2 removed",
          );
          expect(JSON.parse(await posts(cdp)).map((p) => p.on)).toEqual([
            true,
            false,
          ]);
        });
      }, 60000);

      it("the grid badge follows the approval and only shows for the shown version", async () => {
        await open(
          width,
          "en&approved2",
          async (cdp) => {
            await until(
              async () =>
                (await text(cdp, "[data-testid=approved-0]")) ===
                "Approved in v2",
              "badge",
            );
            const tile = await cdp.evaluate(rect("[data-testid=tile-0]"));
            const badge = await cdp.evaluate(rect("[data-testid=approved-0]"));
            expect(badge.left).toBeGreaterThanOrEqual(tile.left);
            expect(badge.bottom).toBeLessThanOrEqual(tile.bottom);
            expect(
              await cdp.evaluate(
                "getComputedStyle(document.querySelector('[data-testid=approved-0]')).pointerEvents",
              ),
            ).toBe("none");
            expect(await text(cdp, "[data-testid=approved-1]")).toBeNull();
          },
          { lightbox: false },
        );
      }, 60000);

      it("a new version re-opens it: approved at v2 but v3 is shown means 'Approve v3', no badge", async () => {
        await open(
          width,
          "en&approved2&ver3",
          async (cdp) => {
            await cdp.evaluate(
              "document.querySelector('[data-testid=open-0]').click()",
            );
            await until(
              async () =>
                (await text(cdp, "[data-testid=approve]")) === "Approve v3",
              "button for v3",
            );
            expect(await pressed(cdp)).toBe("false");
            expect(await text(cdp, "[data-testid=approved-0]")).toBeNull();
            await press(cdp, width, "[data-testid=approve]");
            await until(async () => (await pressed(cdp)) === "true", "pressed");
            expect(await posts(cdp)).toBe(
              JSON.stringify([{ photoId: "p0", version: 3, on: true }]),
            );
          },
          { lightbox: false },
        );
      }, 60000);

      it("a refused approval really reverts and says why (toast); a stale one asks to reload", async () => {
        await open(width, "en&fail", async (cdp) => {
          await press(cdp, width, "[data-testid=approve]");
          await until(
            async () =>
              (await cdp.evaluate(
                "document.getElementById('root').textContent.includes('Couldn\\'t save the approval')",
              )) === true,
            "error toast",
          );
          expect(await pressed(cdp)).toBe("false");
          expect(await text(cdp, "[data-testid=approve]")).toBe("Approve v2");
        });
        await open(width, "en&stale", async (cdp) => {
          await press(cdp, width, "[data-testid=approve]");
          await until(
            async () =>
              (await cdp.evaluate(
                "document.getElementById('root').textContent.includes('new version of this photo')",
              )) === true,
            "stale toast",
          );
          expect(await pressed(cdp)).toBe("false");
        });
      }, 60000);

      it("a photo with no history approves v1; the button never overlaps the version cluster, the nav buttons or the top bar", async () => {
        await open(width, "es", async (cdp) => {
          const b = await cdp.evaluate(rect("[data-testid=approve]"));
          expect(b.text).toBe("Aprobar v2");
          expect(b.right).toBeLessThanOrEqual(width);
          expect(b.bottom).toBeLessThanOrEqual(800);
          expect(b.h).toBeGreaterThanOrEqual(44);
          const cluster = await cdp.evaluate(
            rect("[data-testid=lightbox-versions]"),
          );
          expect(overlap(b, cluster)).toBe(false);
          for (const label of ["Anterior", "Siguiente", "Cerrar"]) {
            const r = await cdp.evaluate(rect(`button[aria-label=${label}]`));
            if (r) expect(overlap(b, r), label).toBe(false);
          }
          // Next photo (no history): v1.
          await cdp.evaluate(
            "document.querySelector('button[aria-label=Siguiente]').click()",
          );
          await until(
            async () =>
              (await text(cdp, "[data-testid=approve]")) === "Aprobar v1",
            "v1 button",
          );
          expect(await pressed(cdp)).toBe("false");
        });
      }, 60000);

      it("an album without approvals shows no button, no badge and makes no approvals call", async () => {
        await open(width, "es&off&approved2", async (cdp) => {
          expect(await text(cdp, "[data-testid=approve]")).toBeNull();
          expect(await text(cdp, "[data-testid=approved-0]")).toBeNull();
          expect(await posts(cdp)).toBe("[]");
          expect(
            await cdp.evaluate(
              "document.getElementById('root').textContent.includes('Aprob')",
            ),
          ).toBe(false);
        });
      }, 60000);
    });
  }
});
