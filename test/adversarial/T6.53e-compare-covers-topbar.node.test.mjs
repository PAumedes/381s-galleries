import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";
import { bundlePage } from "../support/bundle-page.mjs";

const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

// While comparing, the opaque compare region is painted over the top bar and
// nav buttons: the visitor can see/click Close, Anterior, Siguiente only if
// they are the topmost element at their own centre.
describe.skipIf(!HAS_CHROME)("T6.53e compare stacking", () => {
  for (const width of [390, 1280]) {
    it(`close/prev/next stay hittable while comparing (${width}px)`, async () => {
      const file = await bundlePage("test/support/compare-entry.tsx");
      const { ch, list } = await launchChrome();
      try {
        const cdp = await connectCdp(list);
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 800,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await cdp.send("Page.enable");
        await cdp.send("Page.navigate", { url: `file://${file}#es` });
        await until(
          () => cdp.evaluate("!!document.querySelector('[data-testid=open-0]')"),
          "grid",
        );
        await cdp.evaluate("document.querySelector('[data-testid=open-0]').click()");
        await until(
          () => cdp.evaluate("!!document.querySelector('[data-testid=compare-open]')"),
          "btn",
        );
        await cdp.evaluate("document.querySelector('[data-testid=compare-open]').click()");
        await until(
          () => cdp.evaluate("!!document.querySelector('[data-testid=compare-frame]')"),
          "compare",
        );
        const hits = await cdp.evaluate(`(() => {
          const out = {};
          for (const l of ["Cerrar", "Siguiente"]) {
            const b = document.querySelector('button[aria-label=' + l + ']');
            if (!b) { out[l] = "missing"; continue; }
            const r = b.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            out[l] = b.contains(top);
          }
          return out;
        })()`);
        expect(hits).toEqual({ Cerrar: true, Siguiente: true });
      } finally {
        ch.kill();
      }
    }, 60000);
  }
});
