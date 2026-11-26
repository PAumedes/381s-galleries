import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";
import { bundlePage } from "../support/bundle-page.mjs";

// T6.53e in real Chrome: the real lightbox of a versioned album comparing v3
// with v2 (inline SVG previews of different sizes) at phone and desktop width.
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

let file;
const page = async () =>
  (file ??= await bundlePage("test/support/compare-entry.tsx"));

async function open(width, hash, steps) {
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
    await cdp.evaluate(
      "document.querySelector('[data-testid=open-0]').click()",
    );
    await until(
      () =>
        cdp.evaluate("!!document.querySelector('[data-testid=compare-open]')"),
      "compare button",
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
    text: el.textContent.trim() };
})()`;
const overlap = (a, b) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const key = async (cdp, k, code, vk, text) => {
  const base = { key: k, code, windowsVirtualKeyCode: vk };
  await cdp.send("Input.dispatchKeyEvent", {
    type: text ? "keyDown" : "rawKeyDown",
    ...(text ? { text } : {}),
    ...base,
  });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
};
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

const opened = async (cdp) => {
  await cdp.evaluate(
    "document.querySelector('[data-testid=compare-open]').click()",
  );
  await until(
    () =>
      cdp.evaluate("!!document.querySelector('[data-testid=compare-frame]')"),
    "compare",
  );
  await until(
    () =>
      cdp.evaluate("!document.querySelector('[data-testid=compare-loading]')"),
    "both previews loaded",
  );
};
const value = (cdp) =>
  cdp.evaluate(
    "document.querySelector('[role=slider]').getAttribute('aria-valuenow')",
  );
const counter = (cdp) =>
  cdp.evaluate(
    "document.querySelector('[role=dialog]').textContent.match(/\\d+ \\/ \\d+/)?.[0]",
  );

describe.skipIf(!HAS_CHROME)("T6.53e version compare in real Chrome", () => {
  for (const width of [390, 1280]) {
    describe(`${width}px`, () => {
      it("button copy, layout (clear of the bars, nav zones and the version cluster), letterboxing", async () => {
        await open(width, "es", async (cdp) => {
          expect(
            (await cdp.evaluate(rect("[data-testid=compare-open]"))).text,
          ).toBe("Comparar con v2");
          await opened(cdp);
          const frame = await cdp.evaluate(rect("[data-testid=compare-frame]"));
          expect(frame.left).toBeGreaterThanOrEqual(0);
          expect(frame.right).toBeLessThanOrEqual(width);
          expect(frame.top).toBeGreaterThanOrEqual(0);
          expect(frame.bottom).toBeLessThanOrEqual(800);
          expect(frame.h).toBeGreaterThan(200);
          const cluster = await cdp.evaluate(
            rect("[data-testid=lightbox-versions]"),
          );
          expect(overlap(frame, cluster)).toBe(false);
          expect(frame.bottom).toBeLessThanOrEqual(cluster.top);
          for (const label of ["Anterior", "Siguiente", "Cerrar"]) {
            const r = await cdp.evaluate(rect(`button[aria-label=${label}]`));
            expect(overlap(frame, r), label).toBe(false);
          }
          // Toolbar of modes is on screen and not under the top bar.
          const modes = await cdp.evaluate(
            rect("[data-testid=compare-mode-flip]"),
          );
          const close = await cdp.evaluate(rect("button[aria-label=Cerrar]"));
          expect(modes.top).toBeGreaterThanOrEqual(close.bottom - 1);
          // The button that closes the comparison is still reachable.
          expect(
            (await cdp.evaluate(rect("[data-testid=compare-open]"))).text,
          ).toBe("Cerrar comparación");
          // Letterbox: different natural sizes, one box, same fit and alignment.
          const info = await cdp.evaluate(`(() => {
            const get = (id) => {
              const i = document.querySelector('[data-testid=' + id + ']');
              const r = i.getBoundingClientRect(); const s = getComputedStyle(i);
              return { nw: i.naturalWidth, nh: i.naturalHeight, w: r.width, h: r.height,
                left: r.left, top: r.top, fit: s.objectFit, pos: s.objectPosition };
            };
            return { a: get('compare-img-a'), b: get('compare-img-b') };
          })()`);
          expect([info.a.nw, info.a.nh]).toEqual([1200, 800]);
          expect([info.b.nw, info.b.nh]).toEqual([800, 800]);
          expect(info.a.fit).toBe("contain");
          expect(info.b.fit).toBe("contain");
          expect(info.a.pos).toBe(info.b.pos);
          expect([info.a.left, info.a.top, info.a.w, info.a.h]).toEqual([
            info.b.left,
            info.b.top,
            info.b.w,
            info.b.h,
          ]);
          expect(Math.round(info.a.w)).toBe(Math.round(frame.w));
          expect(Math.round(info.a.h)).toBe(Math.round(frame.h));
        });
      }, 60000);

      it("flip: click and Space toggle A/B with a v3 / v2 label", async () => {
        await open(width, "en", async (cdp) => {
          await opened(cdp);
          expect(
            (await cdp.evaluate(rect("[data-testid=compare-label]"))).text,
          ).toBe("v3 / v2");
          const shown = () =>
            cdp.evaluate(
              "[...document.querySelectorAll('[data-testid^=compare-img-]')].filter((i) => getComputedStyle(i).opacity === '1').map((i) => i.dataset.testid)",
            );
          expect(await shown()).toEqual(["compare-img-a"]);
          const flip = await cdp.evaluate(rect("[data-testid=compare-flip]"));
          if (width < 768) {
            await touch(
              cdp,
              "touchStart",
              flip.left + flip.w / 2,
              flip.top + flip.h / 2,
            );
            await touch(cdp, "touchEnd");
          } else {
            await mouse(
              cdp,
              "mousePressed",
              flip.left + flip.w / 2,
              flip.top + flip.h / 2,
            );
            await mouse(
              cdp,
              "mouseReleased",
              flip.left + flip.w / 2,
              flip.top + flip.h / 2,
            );
          }
          await until(
            async () => (await shown()).join() === "compare-img-b",
            "flipped",
          );
          expect(
            await cdp.evaluate(
              "document.querySelector('[data-testid=compare-label-2]').getAttribute('aria-current')",
            ),
          ).toBe("true");
          expect(
            await cdp.evaluate("document.activeElement.dataset.testid"),
          ).toBe("compare-flip");
          await key(cdp, " ", "Space", 32, " ");
          await until(
            async () => (await shown()).join() === "compare-img-a",
            "flipped back",
          );
          expect(await counter(cdp)).toBe("1 / 3");
        });
      }, 60000);

      it("slider: pointer drag, keyboard, clip-path, no swipe to another photo", async () => {
        await open(width, "en", async (cdp) => {
          await opened(cdp);
          await cdp.evaluate(
            "document.querySelector('[data-testid=compare-mode-slide]').click()",
          );
          await until(
            () => cdp.evaluate("!!document.querySelector('[role=slider]')"),
            "slider",
          );
          const f = await cdp.evaluate(rect("[data-testid=compare-frame]"));
          const y = f.top + f.h / 2;
          const at = (p) => f.left + (f.w * p) / 100;
          const clip = () =>
            cdp.evaluate(
              "getComputedStyle(document.querySelector('[data-testid=compare-img-a]')).clipPath",
            );
          expect(await value(cdp)).toBe("50");
          if (width < 768) {
            await touch(cdp, "touchStart", at(20), y);
            for (let p = 20; p <= 80; p += 10)
              await touch(cdp, "touchMove", at(p), y);
            await touch(cdp, "touchEnd");
          } else {
            await mouse(cdp, "mousePressed", at(20), y);
            for (let p = 20; p <= 80; p += 10)
              await mouse(cdp, "mouseMoved", at(p), y);
            await mouse(cdp, "mouseReleased", at(80), y);
          }
          await until(
            async () => Math.abs(Number(await value(cdp)) - 80) <= 1,
            "drag to 80",
          );
          expect(await clip()).toMatch(/inset\(0px 2\d(\.\d+)?% 0px 0px\)/);
          expect(await counter(cdp)).toBe("1 / 3");
          // The handle is where the value says, inside the frame.
          const h = await cdp.evaluate(rect("[role=slider]"));
          expect(Math.abs((h.left + h.right) / 2 - at(80))).toBeLessThan(
            f.w * 0.02 + 1,
          );
          // Keyboard.
          await cdp.evaluate("document.querySelector('[role=slider]').focus()");
          await key(cdp, "ArrowLeft", "ArrowLeft", 37);
          await until(
            async () => Math.abs(Number(await value(cdp)) - 75) <= 1,
            "arrow left",
          );
          await key(cdp, "Home", "Home", 36);
          await until(async () => (await value(cdp)) === "0", "home");
          expect(await clip()).toMatch(/inset\(0px 100% 0px 0px\)/);
          await key(cdp, "End", "End", 35);
          await until(async () => (await value(cdp)) === "100", "end");
          expect(await counter(cdp)).toBe("1 / 3");
          expect(
            await cdp.evaluate("!!document.querySelector('[role=dialog]')"),
          ).toBe(true);
        });
      }, 60000);

      it("Escape closes the comparison first, then the history, then the lightbox", async () => {
        await open(width, "en", async (cdp) => {
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
          await opened(cdp);
          expect(
            await cdp.evaluate(
              "!!document.querySelector('[data-testid=versions-panel]')",
            ),
          ).toBe(false);
          const gone = (sel) =>
            until(
              async () =>
                !(await cdp.evaluate(`!!document.querySelector('${sel}')`)),
              sel,
            );
          await key(cdp, "Escape", "Escape", 27);
          await gone("[data-testid=compare]");
          expect(
            await cdp.evaluate(
              "!!document.querySelector('[data-testid=versions-panel]')",
            ),
          ).toBe(true);
          expect(
            await cdp.evaluate("!!document.querySelector('[role=dialog]')"),
          ).toBe(true);
          await key(cdp, "Escape", "Escape", 27);
          await gone("[data-testid=versions-panel]");
          expect(
            await cdp.evaluate("!!document.querySelector('[role=dialog]')"),
          ).toBe(true);
          await key(cdp, "Escape", "Escape", 27);
          await gone("[role=dialog]");
        });
      }, 60000);

      it("a preview that fails shows the error and a retry; Tab stays inside the dialog", async () => {
        await open(width, "en&fail2", async (cdp) => {
          await cdp.evaluate(
            "document.querySelector('[data-testid=compare-open]').click()",
          );
          await until(
            () => cdp.evaluate("!!document.querySelector('[role=alert]')"),
            "error",
          );
          expect((await cdp.evaluate(rect("[role=alert]"))).text).toContain(
            "One of the previews could not be loaded",
          );
          await key(cdp, "Tab", "Tab", 9);
          expect(
            await cdp.evaluate(
              "!!document.activeElement.closest('[role=dialog]')",
            ),
          ).toBe(true);
        });
      }, 60000);
    });
  }
});
