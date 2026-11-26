import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";
import { bundlePage } from "../support/bundle-page.mjs";

// T6.54 (6): two consecutive wrong PINs each re-trigger the feedback in real
// Chrome (shake, announced error with the attempt number, cleared and
// refocused field, pending button); reduced motion swaps the shake for a
// static, non-motion error style.
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

async function withGate(file, { reduce = false } = {}, fn) {
  const { ch, list } = await launchChrome();
  try {
    const cdp = await connectCdp(list);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 360,
      height: 700,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [
        {
          name: "prefers-reduced-motion",
          value: reduce ? "reduce" : "no-preference",
        },
      ],
    });
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: `file://${file}#es` });
    await until(
      () => cdp.evaluate("!!document.querySelector('input[name=pin]')"),
      "gate",
    );
    return await fn(cdp);
  } finally {
    ch.kill();
  }
}

const submitWrong = async (cdp, pin) => {
  await cdp.evaluate(`(() => {
    const i = document.querySelector('input[name=pin]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(pin)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.form.requestSubmit();
  })()`);
};
const release = async (cdp) => {
  await until(
    () => cdp.evaluate("typeof window.__release === 'function'"),
    "action pending",
  );
  await cdp.evaluate(
    "(() => { const r = window.__release; window.__release = undefined; r(); })()",
  );
};
const FEEDBACK = `(() => {
  const i = document.querySelector('input[name=pin]');
  const w = i.closest('[data-pin-shake]');
  const a = document.querySelector('[role=alert]');
  const cs = getComputedStyle(w || i);
  return { alert: a && a.textContent, value: i.value, focused: document.activeElement === i,
    invalid: i.getAttribute('aria-invalid'), attempt: document.querySelector('input[name=attempt]').value,
    anim: cs.animationName, borderW: getComputedStyle(i).borderBottomWidth,
    running: !!w && w.getAnimations().some((x) => x.animationName === 'pin-shake' && x.playState === 'running'),
    live: a ? { role: a.getAttribute('role') } : null };
})()`;

describe.skipIf(!HAS_CHROME)("T6.54 PIN gate feedback in Chrome", () => {
  let file;
  it("two wrong PINs in a row: each one pends, then shakes again, announces its own attempt number, clears and refocuses", async () => {
    file ??= await bundlePage("test/support/pin-gate-entry.tsx");
    await withGate(file, {}, async (cdp) => {
      // before any attempt: nothing shown
      expect(
        await cdp.evaluate("!!document.querySelector('[role=alert]')"),
      ).toBe(false);

      await submitWrong(cdp, "111111");
      // pending: disabled, busy
      await until(
        () =>
          cdp.evaluate(
            "(() => { const b = document.querySelector('button[type=submit]'); return b.disabled && b.getAttribute('aria-busy') === 'true'; })()",
          ),
        "pending button",
      );
      await release(cdp);
      await until(
        () =>
          cdp.evaluate(
            "document.querySelector('[role=alert]')?.textContent.includes('intento 1')",
          ),
        "first answer",
      );
      // mark this attempt's nodes, to prove the next attempt renders new ones
      await cdp.evaluate(
        "document.querySelector('[role=alert]').__first = true; document.querySelector('input[name=pin]').__first = true",
      );
      const first = await cdp.evaluate(FEEDBACK);
      expect(first).toMatchObject({
        alert: "PIN del cliente incorrecto (intento 1)",
        value: "",
        focused: true,
        invalid: "true",
        attempt: "1",
        anim: "pin-shake",
        running: true,
      });

      await submitWrong(cdp, "222222");
      await release(cdp);
      await until(
        () =>
          cdp.evaluate(
            "document.querySelector('[role=alert]')?.textContent.includes('intento 2')",
          ),
        "second answer",
      );
      const second = await cdp.evaluate(FEEDBACK);
      expect(second).toMatchObject({
        alert: "PIN del cliente incorrecto (intento 2)",
        value: "",
        focused: true,
        invalid: "true",
        attempt: "2",
        anim: "pin-shake",
        running: true,
      });
      // the announcement and the field are fresh elements (a live region re-announces; the animation restarts)
      expect(
        await cdp.evaluate(
          "document.querySelector('[role=alert]').__first === undefined && document.querySelector('input[name=pin]').__first === undefined",
        ),
      ).toBe(true);
      // the button is usable again
      expect(
        await cdp.evaluate(
          "!document.querySelector('button[type=submit]').disabled",
        ),
      ).toBe(true);
    });
  }, 90000);

  it("prefers-reduced-motion: no movement, but a static error style (thick border) and the announced text remain", async () => {
    file ??= await bundlePage("test/support/pin-gate-entry.tsx");
    await withGate(file, { reduce: true }, async (cdp) => {
      await submitWrong(cdp, "111111");
      await release(cdp);
      await until(
        () => cdp.evaluate("!!document.querySelector('[role=alert]')"),
        "answer",
      );
      const m = await cdp.evaluate(FEEDBACK);
      expect(m.anim).toBe("none");
      expect(m.running).toBe(false);
      expect(parseFloat(m.borderW)).toBeGreaterThanOrEqual(2);
      expect(m.alert).toMatch(/intento 1/);
    });
  }, 90000);
});
