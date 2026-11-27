import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { bundlePage } from "../support/bundle-page.mjs";
import { connectCdp, launchChrome, until } from "../support/chrome.mjs";
import { classesOf, css, sourcesOf } from "../support/tailwind-css.mjs";

// T6.58 in real Chrome: the real WizardView at a phone (390) and a desktop
// (1280) width, every step, Spanish and English. Targets of 44px or more, text
// of 16px or more, good contrast, nothing overflows sideways, the keyboard
// reaches Back / Next, reduced motion leaves nothing animated.
const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;

let file;
const page = async () =>
  (file ??= await bundlePage("test/support/wizard-entry.tsx", {
    bodyAttrs: "data-admin",
  }));

const browsers = [];
afterAll(() => browsers.forEach((ch) => ch.kill()));

async function open(width, query, steps, { reducedMotion = false } = {}) {
  const { ch, list } = await launchChrome();
  browsers.push(ch);
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
  if (reducedMotion)
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", {
    url: `file://${await page()}${query ? `?${query}` : ""}`,
  });
  await until(
    () => cdp.evaluate("!!document.querySelector('h1, section')"),
    "the wizard page",
  );
  try {
    return await steps(cdp);
  } finally {
    ch.kill();
  }
}

// Contrast ratio of an element's text colour over its effective background.
const CONTRAST = `(el) => {
  const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const rgba = (s) => { const m = s.match(/[\\d.]+/g).map(Number); return { c: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };
  let bg = [255, 255, 255];
  const stack = []; for (let e = el; e; e = e.parentElement) stack.unshift(getComputedStyle(e).backgroundColor);
  for (const s of stack) { const { c, a } = rgba(s); if (a > 0) bg = c.map((x, i) => x * a + bg[i] * (1 - a)); }
  const fg = rgba(getComputedStyle(el).color).c;
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}`;

// What every step must satisfy, measured on the page as it is.
const AUDIT = `(() => {
  const contrast = ${CONTRAST};
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const small = [], tiny = [], low = [];
  for (const e of document.querySelectorAll("a, button, input, summary")) {
    if (!visible(e)) continue;
    // The small "?" help links keep a 48px box on phones (HelpLink) and 32px from md up.
    const min = e.matches("[data-compact]") ? (innerWidth < 768 ? 44 : 32) : 44;
    const r = e.getBoundingClientRect();
    if (Math.round(r.height) < min || Math.round(r.width) < min) small.push(e.textContent.trim().slice(0, 30) + " " + Math.round(r.width) + "x" + Math.round(r.height));
  }
  for (const e of document.querySelectorAll("h1, h2, p, li, a, button, label, strong, input")) {
    if (!visible(e)) continue;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own && !e.matches("input")) continue;
    if (e.matches("[aria-hidden=true]") || e.closest("[aria-hidden=true]")) continue;
    const fs = parseFloat(getComputedStyle(e).fontSize);
    if (fs < 16) tiny.push(e.tagName + " " + fs + " " + e.textContent.trim().slice(0, 30));
    const c = contrast(e);
    if (c < 7) low.push(e.tagName + " " + c.toFixed(1) + " " + e.textContent.trim().slice(0, 30));
  }
  return {
    overflowX: document.documentElement.scrollWidth - innerWidth,
    small, tiny, low,
    h1: document.querySelectorAll("h1").length,
    progress: document.querySelector("header p:nth-of-type(2)")?.textContent ?? "",
  };
})()`;

describe.skipIf(!HAS_CHROME).each([390, 1280])(
  "T6.58 wizard in real Chrome at %ipx",
  (width) => {
    for (const scenario of ["empty", "ready", "draft"])
      for (const lang of ["es", "en"])
        it(`${scenario} (${lang}): every step fits, with 44px targets, 16px text and strong contrast`, async () => {
          await open(width, "", async (cdp) => {
            for (let step = 1; step <= 6; step++) {
              await cdp.send("Page.navigate", {
                url: `file://${await page()}?step=${step}&scenario=${scenario}&lang=${lang}`,
              });
              await until(
                () =>
                  cdp.evaluate(
                    `document.querySelector("h2") && document.body.textContent.includes(${JSON.stringify(
                      lang === "en" ? `Step ${step} of 6` : `Paso ${step} de 6`,
                    )})`,
                  ),
                `step ${step}`,
              );
              const r = await cdp.evaluate(AUDIT);
              const id = `${scenario} ${lang} step ${step}`;
              expect(r.overflowX, id).toBeLessThanOrEqual(0);
              expect(r.small, id).toEqual([]);
              expect(r.tiny, id).toEqual([]);
              expect(r.low, id).toEqual([]);
              expect(r.h1, id).toBe(1);
            }
          });
        }, 90000);

    it("the current step is marked, and each step state is a word", async () => {
      await open(width, "step=3&scenario=ready", async (cdp) => {
        const r = await cdp.evaluate(`(() => {
          const nav = document.querySelector("nav[aria-label]");
          const cur = nav.querySelector('[aria-current="step"]');
          return {
            idx: [...nav.querySelectorAll("li")].indexOf(cur.closest("li")),
            states: [...nav.querySelectorAll("li")].map((l) => l.textContent),
            bar: document.querySelector("[data-progress-bar]").style.width,
          };
        })()`);
        expect(r.idx).toBe(2);
        expect(r.states[0]).toContain("Hecho");
        expect(r.states[1]).toContain("Para leer");
        expect(r.states[2]).toContain("Hecho");
        expect(r.bar).toBe("50%");
      });
    }, 60000);

    it("long names and links wrap instead of widening the page", async () => {
      for (const step of [4, 5, 6])
        await open(width, `step=${step}&scenario=ready`, async (cdp) => {
          expect(
            await cdp.evaluate(
              "document.documentElement.scrollWidth - innerWidth",
            ),
          ).toBeLessThanOrEqual(0);
        });
    }, 90000);

    it("the keyboard reaches Next, shows a focus ring and follows the link", async () => {
      await open(width, "step=2&scenario=ready", async (cdp) => {
        await cdp.evaluate(
          "document.querySelector('h1').setAttribute('tabindex','-1'); document.querySelector('h1').focus()",
        );
        const seen = [];
        for (let i = 0; i < 40 && !seen.includes("Siguiente"); i++) {
          for (const type of ["keyDown", "keyUp"])
            await cdp.send("Input.dispatchKeyEvent", {
              type,
              key: "Tab",
              code: "Tab",
              windowsVirtualKeyCode: 9,
            });
          seen.push(
            await cdp.evaluate("document.activeElement.textContent.trim()"),
          );
        }
        expect(seen).toContain("Atrás");
        expect(seen.at(-1)).toBe("Siguiente");
        const ring = await cdp.evaluate(
          "parseFloat(getComputedStyle(document.activeElement).outlineWidth)",
        );
        expect(ring).toBeGreaterThanOrEqual(2);
      });
    }, 60000);

    // The global admin rule shortens every transition to 0.01ms under reduced motion; the wizard adds none of its own.
    it("reduced motion: nothing in the wizard animates or transitions", async () => {
      await open(
        width,
        "step=3&scenario=empty&error=1",
        async (cdp) => {
          const moving =
            await cdp.evaluate(`[...document.querySelectorAll("*")].filter((e) => {
            const s = getComputedStyle(e);
            return parseFloat(s.transitionDuration) > 0.001 || (s.animationName !== "none" && parseFloat(s.animationDuration) > 0.001);
          }).length`);
          expect(moving).toBe(0);
        },
        { reducedMotion: true },
      );
    }, 60000);

    it("the create-client form shows its error next to the field", async () => {
      await open(width, "step=3&scenario=empty&error=1", async (cdp) => {
        const r = await cdp.evaluate(`(() => {
          const i = document.querySelector('input[name=name]');
          const err = document.getElementById(i.getAttribute('aria-describedby').split(' ').find((x) => x.endsWith('-err')));
          return { invalid: i.getAttribute('aria-invalid'), h: i.getBoundingClientRect().height, err: err?.textContent, fs: parseFloat(getComputedStyle(i).fontSize) };
        })()`);
        expect(r.invalid).toBe("true");
        expect(r.err).toContain("Escribí un nombre");
        expect(r.h).toBeGreaterThanOrEqual(44);
        expect(r.fs).toBeGreaterThanOrEqual(16);
      });
    }, 60000);

    it("the home banner fits with 44px buttons", async () => {
      await open(width, "view=banner", async (cdp) => {
        const r = await cdp.evaluate(AUDIT);
        expect(r.overflowX).toBeLessThanOrEqual(0);
        expect(r.small).toEqual([]);
        expect(r.tiny).toEqual([]);
        expect(r.low).toEqual([]);
      });
    }, 60000);
  },
);

describe("T6.58 production CSS carries the wizard classes", () => {
  // Built the way production builds it (app.css scans app/), from the wizard sources.
  it("has the classes the wizard needs to be readable and touch friendly", async () => {
    const out = await css(
      classesOf([
        ...sourcesOf("app/components/admin/wizard"),
        ...sourcesOf("app/components/admin/help"),
      ]),
    );
    for (const c of [
      ".min-h-12",
      ".border-s-4",
      ".ps-3",
      ".ps-6",
      ".list-disc",
      ".max-w-prose",
      ".text-base",
      ".border-ink",
      ".bg-ink",
      ".text-paper",
      ".underline-offset-4",
      ".\\[overflow-wrap\\:anywhere\\]",
      ".sm\\:flex-row",
      ".focus-visible\\:outline-2",
      ".disabled\\:opacity-40",
    ])
      expect(out, c).toContain(c);
  });
});
