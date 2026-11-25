import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";

// T6.54 (5): what real Chrome actually sends on the way client page -> album
// gate -> PIN POST -> 303 -> album, with `Referrer-Policy: same-origin` (the
// header the album pages send) and no JavaScript (a form POST + redirect). It
// records every request's Referer and Cookie, and shows the two facts the
// fix rests on: (a) the Referer of the page after the unlock is the ALBUM's
// own URL, never the client page, so a Referer-only rule loses the back link;
// (b) a SameSite=Lax cookie set on the first visit IS sent on that chain.
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

function harness() {
  const seen = [];
  const server = createServer((req, res) => {
    const body = [];
    req.on("data", (c) => body.push(c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      seen.push({
        method: req.method,
        path: url.pathname,
        referer: req.headers.referer ?? null,
        cookie: req.headers.cookie ?? null,
      });
      const h = {
        "Referrer-Policy": "same-origin",
        "Cache-Control": "no-store",
      };
      const html = (s, extra = {}) => {
        res.writeHead(200, { ...h, "Content-Type": "text/html", ...extra });
        res.end(`<!doctype html><meta charset=utf-8>${s}`);
      };
      if (url.pathname === "/acme")
        return html('<a id=tile href="/acme/boda">Boda</a>');
      if (url.pathname === "/acme/boda" && req.method === "POST") {
        res.writeHead(303, { ...h, Location: "/acme/boda" });
        return res.end();
      }
      if (url.pathname === "/acme/boda") {
        const fromPage = /^http:\/\/[^/]+\/acme$/.test(
          req.headers.referer ?? "",
        );
        const cookie = (req.headers.cookie ?? "").includes("b=1");
        const extra = fromPage
          ? {
              "Set-Cookie": "b=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600",
            }
          : {};
        return html(
          `<p id=ref>${fromPage ? "client" : "other"}</p><p id=cookie>${cookie ? "yes" : "no"}</p><form method=post id=gate><input name=pin value=1><button>go</button></form>`,
          extra,
        );
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        seen,
        server,
        base: `http://127.0.0.1:${server.address().port}`,
      }),
    ),
  );
}

describe.skipIf(!HAS_CHROME)(
  "T6.54 Referer and cookie across the PIN POST in Chrome (no JS)",
  () => {
    it("the Referer after the unlock is the album, not the client page; the first-visit cookie still arrives", async () => {
      const h = await harness();
      const { ch, list } = await launchChrome();
      try {
        const cdp = await connectCdp(list);
        await cdp.send("Page.enable");
        await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
        await cdp.send("Page.navigate", { url: `${h.base}/acme` });
        await until(
          () => cdp.evaluate("!!document.getElementById('tile')"),
          "client page",
        );
        await cdp.evaluate("document.getElementById('tile').click()");
        await until(
          () => cdp.evaluate("!!document.getElementById('gate')"),
          "gate",
        );
        // the visit from the client page: Referer was the client page
        expect(
          await cdp.evaluate("document.getElementById('ref').textContent"),
        ).toBe("client");
        // unlock: native form POST, then the 303 GET
        await cdp.evaluate(
          "document.cookie.length; document.getElementById('gate').requestSubmit()",
        );
        await until(
          () => h.seen.filter((r) => r.path === "/acme/boda").length >= 3,
          "POST + redirected GET",
        );
        const [first, post, after] = h.seen.filter(
          (r) => r.path === "/acme/boda",
        );
        expect(first.referer).toBe(`${h.base}/acme`);
        expect(post.method).toBe("POST");
        expect(post.referer).toBe(`${h.base}/acme/boda`);
        // (a) the Referer of the page after the unlock is the album itself
        expect(after.method).toBe("GET");
        expect(after.referer).toBe(`${h.base}/acme/boda`);
        // (b) but the cookie from the first visit travelled on every step
        expect(post.cookie).toContain("b=1");
        expect(after.cookie).toContain("b=1");
      } finally {
        ch.kill();
        h.server.close();
      }
    }, 60000);
  },
);
