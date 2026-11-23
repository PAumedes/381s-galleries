import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";
import { css } from "../support/tailwind-css.mjs";

const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

const CLASSES = [
  "phone:inset-y-auto",
  "phone:top-1/2",
  "phone:hidden",
  "phone:p-4",
];

// Strips every @media block so only selectors outside one remain.
function outsideMedia(text) {
  let out = "";
  let depth = 0;
  let inMedia = [];
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("@media", i)) inMedia.push(depth);
    const ch = text[i];
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (inMedia.length && inMedia[inMedia.length - 1] === depth)
        inMedia.pop();
    }
    if (!inMedia.length) out += ch;
  }
  return out;
}

describe("T6.44 phone variant CSS", () => {
  it("emits no media condition as a selector suffix", async () => {
    const text = await css(CLASSES);
    expect(text).toContain("phone\\:hidden");
    expect(outsideMedia(text)).not.toMatch(/\(max-width|\(pointer/);
  });
});

let server;
let origin;
beforeAll(async () => {
  if (!HAS_CHROME) return;
  const style = await css(CLASSES);
  server = createServer((req, res) => {
    if (req.url === "/app.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(style);
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        '<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=/app.css><body><p id=t class="phone:hidden">x</p>',
      );
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
}, 60000);
afterAll(() => server?.close());

async function hiddenAt(width, coarse) {
  const { ch, list } = await launchChrome();
  try {
    const cdp = await connectCdp(list);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: coarse,
    });
    // Touch emulation is what makes Chrome report `pointer: coarse`.
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: coarse,
      maxTouchPoints: 5,
    });
    await cdp.send("Page.navigate", { url: origin });
    return await until(async () => {
      const v = await cdp.evaluate(
        `(() => { const e = document.getElementById("t"); return e ? getComputedStyle(e).display + "|" + matchMedia("(pointer: coarse)").matches + "|" + innerWidth : null })()`,
      );
      return v && v.endsWith("|" + width) ? v : null;
    }, "page").then((v) => {
      expect(v.split("|")[1]).toBe(String(coarse));
      return v.startsWith("none");
    });
  } finally {
    ch.kill();
  }
}

describe.skipIf(!HAS_CHROME)("T6.44 phone variant in real Chrome", () => {
  it("applies at 400px with a coarse pointer", async () => {
    expect(await hiddenAt(400, true)).toBe(true);
  }, 30000);
  it("applies at 400px with a fine pointer (max-width branch)", async () => {
    expect(await hiddenAt(400, false)).toBe(true);
  }, 30000);
  it("applies at 1024px with a coarse pointer (touch tablet)", async () => {
    expect(await hiddenAt(1024, true)).toBe(true);
  }, 30000);
  it("does not apply at 1024px with a fine pointer", async () => {
    expect(await hiddenAt(1024, false)).toBe(false);
  }, 30000);
});
