import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { bundlePage } from "../support/bundle-page.mjs";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";

// T6.57: "print" is part of the brief. Every question is a closed <details>, and
// a browser prints a closed <details> as its summary only: a printed help page
// is a list of questions without a single answer, and nothing in the page
// (no print rule, no beforeprint handler) opens them.
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;
const browsers = [];
afterAll(() => browsers.forEach((b) => b.kill()));

describe.skipIf(!HAS_CHROME)("T6.57 adversarial: printing the help", () => {
  it("shows the answer of a closed question in print media", async () => {
    const file = await bundlePage("test/support/help-entry.tsx", {
      bodyAttrs: "data-admin",
    });
    const { ch, list } = await launchChrome();
    browsers.push(ch);
    const cdp = await connectCdp(list);
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: `file://${file}` });
    await until(
      () => cdp.evaluate("!!document.querySelector('details')"),
      "the help page",
    );
    try {
      await cdp.send("Emulation.setEmulatedMedia", { media: "print" });
      const h = await cdp.evaluate(`(() => {
        const d = document.getElementById("albums-publish");
        if (d.open) return -1;
        // fire what a print preview fires first
        window.dispatchEvent(new Event("beforeprint"));
        return d.querySelector("ol").checkVisibility();
      })()`);
      expect(h, "answer of a closed question is rendered when printing").toBe(
        true,
      );
    } finally {
      ch.kill();
    }
  }, 90000);
});
