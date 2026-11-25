import process from "node:process";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";

// T6.51: EmailGate's keyboard behaviour in real Chrome (focus on open, Tab
// trapped inside the dialog both ways, Escape closes, focus returns to the
// opener). The refactor split these effects into useGateKeys; before, only
// happy-dom covered them.
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

const cwd = process.cwd();
const ENTRY = `
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { EmailGate } from "${cwd}/app/components/EmailGate";
import { makeT } from "${cwd}/app/i18n/t";
import { en } from "${cwd}/app/i18n/en";
const t = makeT("en", en);
function App() {
  const [open, setOpen] = useState(false);
  return (<>
    <button id="before">before</button>
    <button id="opener" onClick={() => setOpen(true)}>open</button>
    <button id="after">after</button>
    {open && <EmailGate t={t} onSubmit={async () => "ok"} onClose={() => setOpen(false)} />}
  </>);
}
createRoot(document.getElementById("root")).render(<App />);
`;
const ENTRY_ID = `${cwd}/t651-gate-entry.tsx`;

let server;
let origin;
beforeAll(async () => {
  if (!HAS_CHROME) return;
  const out = await build({
    configFile: false,
    logLevel: "silent",
    root: cwd,
    esbuild: { jsx: "automatic", jsxDev: false },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "entry",
        resolveId: (id) => (id === ENTRY_ID ? ENTRY_ID : null),
        load: (id) => (id === ENTRY_ID ? ENTRY : null),
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: ENTRY_ID, formats: ["iife"], name: "App" },
    },
  });
  const chunks = Array.isArray(out) ? out.flatMap((o) => o.output) : out.output;
  const js = chunks.find((c) => c.type === "chunk").code;
  server = createServer((req, res) => {
    if (req.url === "/app.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(js);
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        "<!doctype html><body><div id=root></div><script src=/app.js></script>",
      );
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
}, 60000);
afterAll(() => server?.close());

describe.skipIf(!HAS_CHROME)("T6.51 EmailGate keyboard in real Chrome", () => {
  it("focuses the email, traps Tab both ways, Escape closes and restores focus to the opener", async () => {
    const { ch, list } = await launchChrome();
    try {
      const cdp = await connectCdp(list);
      await cdp.send("Page.navigate", { url: origin });
      await until(
        () => cdp.evaluate("!!document.getElementById('opener')"),
        "app",
      );
      const key = async (k, code, vk, shift = false) => {
        const base = {
          key: k,
          code,
          windowsVirtualKeyCode: vk,
          modifiers: shift ? 8 : 0,
        };
        await cdp.send("Input.dispatchKeyEvent", {
          type: "rawKeyDown",
          ...base,
        });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      };
      const active = () =>
        cdp.evaluate(
          "(() => { const a = document.activeElement; return a.id || a.getAttribute('aria-label') || a.type || a.tagName; })()",
        );
      await cdp.evaluate(
        "document.getElementById('opener').focus(); document.getElementById('opener').click(); true",
      );
      await until(
        () => cdp.evaluate("!!document.querySelector('[role=dialog]')"),
        "gate",
      );
      await until(async () => (await active()) === "gate-email", "email focus");
      // forward: email -> name -> submit -> (wrap) close button -> email
      await key("Tab", "Tab", 9);
      expect(await active()).toBe("gate-name");
      await key("Tab", "Tab", 9);
      expect(await active()).toBe("submit");
      await key("Tab", "Tab", 9);
      expect(
        await cdp.evaluate(
          "document.activeElement.closest('[role=dialog]') !== null",
        ),
      ).toBe(true);
      expect(await active()).toBe("Close");
      // backward from the first focusable wraps to the last (submit)
      await key("Tab", "Tab", 9, true);
      expect(await active()).toBe("submit");
      await key("Escape", "Escape", 27);
      await until(
        () => cdp.evaluate("!document.querySelector('[role=dialog]')"),
        "gate closed",
      );
      expect(await active()).toBe("opener");
      cdp.close();
    } finally {
      ch.kill();
    }
  }, 60000);
});
