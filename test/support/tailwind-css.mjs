// Compiles app/app.css (real theme, custom variants) for the given class
// candidates, so real-browser tests style their markup like production.
import process from "node:process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { compile } from "tailwindcss";

const require = createRequire(import.meta.url);

export async function css(candidates) {
  const app = readFileSync("app/app.css", "utf8").replace(
    /@import "@fontsource[^;]*;/,
    "",
  );
  const c = await compile(app, {
    base: process.cwd() + "/app",
    loadStylesheet: async (id, base) => {
      const path = id === "tailwindcss" ? "tailwindcss/index.css" : id;
      const file = path.startsWith(".")
        ? require.resolve(path, { paths: [base] })
        : require.resolve(path, { paths: [process.cwd()] });
      return { path: file, base, content: readFileSync(file, "utf8") };
    },
  });
  return c.build(candidates);
}

/** Every class name in the className="..." strings of the given sources. */
export function classesOf(sources) {
  return [
    ...new Set(
      sources
        .flatMap((s) => [...s.matchAll(/["'`]([^"'`]*)["'`]/g)])
        .flatMap((m) => m[1].split(/\s+/))
        .filter(Boolean),
    ),
  ];
}
