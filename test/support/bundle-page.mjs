// Bundles a test entry (a .tsx that renders into #root) with vite's build() API
// and writes a self-contained HTML file styled with the real Tailwind theme.
import process from "node:process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { classesOf, css, sourcesOf } from "./tailwind-css.mjs";

/** `bodyAttrs`: extra attributes for <body> (e.g. `data-admin`). */
export async function bundlePage(
  entry,
  { bodyAttrs = "", extraCss = "" } = {},
) {
  const built = await build({
    configFile: false,
    logLevel: "silent",
    root: process.cwd(),
    esbuild: { jsx: "automatic", jsxDev: false },
    define: { "process.env.NODE_ENV": '"production"' },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: `${process.cwd()}/${entry}`,
        formats: ["iife"],
        name: "App",
      },
    },
  });
  const chunks = Array.isArray(built)
    ? built.flatMap((o) => o.output)
    : built.output;
  const bundled = chunks.find((c) => c.type === "chunk").code;
  const style = await css(classesOf(sourcesOf("app/components")));
  const file = join(mkdtempSync(join(tmpdir(), "bundle-")), "page.html");
  writeFileSync(
    file,
    `<!doctype html><html id=html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>${style}${extraCss}</style><body ${bodyAttrs} style="margin:0;padding:16px"><div id=root></div><script>${bundled.replace(/<\/script/g, "<\\/script")}</script>`,
  );
  return file;
}
