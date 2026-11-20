/* global process */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoverHero } from "../../app/components/CoverHero";
import type { CoverLayout } from "../../app/lib/design";

vi.mock("../../app/components/Logo", () => ({ Logo: () => null }));

const HAS_CHROME =
  spawnSync("google-chrome", ["--version"], { stdio: "ignore" }).status === 0;
const DESKTOP = "http://127.0.0.1:1/desktop.jpg";
const MOBILE = "http://127.0.0.1:1/mobile.jpg";

function markup(layout: CoverLayout, placeholder: string | null) {
  return renderToStaticMarkup(
    <CoverHero
      title="T"
      date={null}
      studio="S"
      src={DESKTOP}
      placeholder={placeholder}
      proofing={false}
      focus={null}
      scrollLabel="go"
      layout={layout}
      mobile={{ src: MOBILE, focus: null, aspect: 1.5 }}
    />,
  );
}

/** currentSrc of every cover image a real Chrome picks at `width` CSS px. */
function currentSrcs(html: string, width: number): string[] {
  const dir = mkdtempSync(join(tmpdir(), "cover-"));
  const file = join(dir, "page.html");
  writeFileSync(
    file,
    `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0">${html}`,
  );
  const r = spawnSync(
    "node",
    [
      join(process.cwd(), "test/support/chrome-cover-srcs.mjs"),
      file,
      String(width),
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(r.stdout);
}

const LAYOUTS: CoverLayout[] = ["completa", "dividida", "centrada"];

describe("Mobile cover <picture> (T6.27)", () => {
  for (const layout of LAYOUTS) {
    it(`${layout}: markup is a valid <picture> (source + exactly one img)`, () => {
      const html = markup(layout, "http://127.0.0.1:1/ph.jpg");
      const pic = /<picture>([\s\S]*?)<\/picture>/.exec(html)?.[1] ?? "";
      expect(pic.match(/<source/g)).toHaveLength(1);
      expect(pic.match(/<img/g)).toHaveLength(1);
    });
    for (const ph of [null, "http://127.0.0.1:1/ph.jpg"]) {
      it.skipIf(!HAS_CHROME)(
        `${layout}${ph ? " with placeholder" : ""}: a 412px phone loads the mobile cover, a 1024px screen the desktop one`,
        () => {
          const html = markup(layout, ph);
          expect(currentSrcs(html, 412)).toEqual([MOBILE]);
          expect(currentSrcs(html, 1024)).toEqual([DESKTOP]);
        },
        30000,
      );
    }
  }
  it("minima has no photo, so no picture", () => {
    expect(markup("minima", null)).not.toContain("<picture");
  });

  describe("JS fallback when the browser ignores <source media>", () => {
    afterEach(() => vi.unstubAllGlobals());
    const stub = (matches: boolean) =>
      vi.stubGlobal("matchMedia", () => ({
        matches,
        addEventListener() {},
        removeEventListener() {},
      }));
    const show = () =>
      render(
        <CoverHero
          title="T"
          date={null}
          studio="S"
          src={DESKTOP}
          proofing={false}
          focus={null}
          scrollLabel="go"
          mobile={{ src: MOBILE, focus: null, aspect: 1.5 }}
        />,
      ).container.querySelector<HTMLImageElement>("img[data-cover-img]")!;
    it("narrow viewport: the img itself points at the mobile cover", () => {
      stub(true);
      expect(show().getAttribute("src")).toBe(MOBILE);
    });
    it("wide viewport: the img keeps the desktop cover", () => {
      stub(false);
      expect(show().getAttribute("src")).toBe(DESKTOP);
    });
  });
});

describe("Mobile cover without a desktop cover (T6.27)", () => {
  it("server HTML has the <picture> source for phones and no desktop src", () => {
    const html = renderToStaticMarkup(
      <CoverHero
        title="T"
        date={null}
        studio="S"
        src={null}
        proofing
        focus={null}
        scrollLabel="go"
        mobile={{ src: MOBILE, focus: null, aspect: 1.5 }}
      />,
    );
    expect(html).toContain(`srcSet="${MOBILE}"`);
    expect(html).toContain('data-testid="cover-shield"');
  });
});
