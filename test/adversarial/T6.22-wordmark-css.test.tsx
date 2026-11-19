import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Wordmark } from "../../app/components/Logo";

afterEach(cleanup);

// @tailwindcss/node is a dependency of @tailwindcss/vite (pnpm does not hoist it).
const viaVite = createRequire(
  createRequire(import.meta.url).resolve("@tailwindcss/vite"),
);
const TW = viaVite.resolve("@tailwindcss/node");

async function css(classes: string[]) {
  const { compile } = await import(/* @vite-ignore */ pathToFileURL(TW).href);
  const c = await compile("@tailwind utilities;", {
    base: process.cwd(),
    onDependency() {},
  });
  return c.build(classes) as string;
}

describe("T6.22 Wordmark vs Tailwind", () => {
  it("a `hidden` className still hides the wordmark (GalleryView top bar: `hidden ... sm:block`)", async () => {
    const { container } = render(
      <Wordmark name="Estudio" className="hidden h-7 sm:block" />,
    );
    const classes = (
      container.firstElementChild as HTMLElement
    ).className.split(/\s+/);
    const out = await css(
      classes.filter((c) => /^(hidden|inline-flex)$/.test(c)),
    );
    const rules = [...out.matchAll(/^\.([\w-]+) \{\s*display: ([\w-]+);/gm)];
    // The LAST display rule among the applied classes wins.
    const winner = rules[rules.length - 1][2];
    expect(winner).toBe("none");
  });

  it("truncate actually ellipsizes: not combined with a flex display on the same element", () => {
    const { container } = render(
      <Wordmark name={"x".repeat(80)} className="h-12" />,
    );
    const cls = (container.firstElementChild as HTMLElement).className;
    // text-overflow does not apply to a flex container's anonymous text item.
    expect(/\btruncate\b/.test(cls) && /\b(inline-)?flex\b/.test(cls)).toBe(
      false,
    );
  });
});

describe("T6.22 admin header overflow", () => {
  it("the AdminShell logo link can shrink (min-w-0) so a long name does not push the menu button off-screen", () => {
    const src = readFileSync("app/components/admin/AdminShell.tsx", "utf8");
    const m =
      /<a\s[^>]*href="\/admin"[^>]*className="([^"]*)"[^>]*>\s*<Logo/s.exec(
        src,
      );
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/(^|\s)min-w-0(\s|$)/);
  });
});

describe("T6.22 stale docs", () => {
  it("README no longer claims the logo is bundled in public/brand", () => {
    expect(readFileSync("README.md", "utf8")).not.toMatch(/public\/brand/);
  });
});
