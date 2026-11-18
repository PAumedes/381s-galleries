// Guard: admin-only code must live only under build/client/admin-assets.
// Run after `pnpm build` (CI does). Exits 1 when any file outside that
// directory carries an admin-only marker, or when the directory is empty.
//   node scripts/check-bundles.mjs [clientDir]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const ADMIN_DIR = "admin-assets";

const ADMIN_INTENTS =
  "disconnect|root|studio|sync|details|flags|design|reorder|focus|archive|restore|publish|draft|status";
const Q = "[`\"']";

/** Distinctive strings that only admin code contains. */
export const MARKERS = [
  {
    name: "admin dictionary key",
    regex: /[`"']admin\.[A-Za-z]+\.[A-Za-z_.]*[A-Za-z_][`"']/,
  },
  { name: "/api/admin", regex: /\/api\/admin/ },
  { name: "admin asset path", regex: /admin-assets/ },
  { name: "adminAction", regex: /\badminAction\b/ },
  { name: "requireAdmin", regex: /\brequireAdmin\b/ },
  {
    name: "admin form intent",
    regex: new RegExp(
      `name:${Q}intent${Q},\\s*value:${Q}(?:${ADMIN_INTENTS})${Q}|\\bintent:${Q}(?:${ADMIN_INTENTS})${Q}`,
    ),
  },
];

// React Router's route manifest lists every route (admin ones included) and
// where its chunk lives: names only, no code. It is exempt from the markers
// that merely name admin routes/files.
const MANIFEST = /^assets\/manifest-[0-9a-f]+\.js$/;
const MANIFEST_EXEMPT = new Set(["admin dictionary key", "admin asset path"]);
const BINARY = /\.(woff2?|png|jpe?g|gif|webp|ico)$/i;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const DICT_ENTRY = /^\s*"([^"\\]+)":\s*("(?:[^"\\]|\\.)*")\s*,?$/gm;

/** Keys and (long, admin-specific) Spanish values of the admin dictionary. */
export function adminDictionaryKeys(i18nDir) {
  const read = (file) => {
    const src = readFileSync(path.join(i18nDir, file), "utf8");
    return [...src.matchAll(DICT_ENTRY)].map((m) => [m[1], JSON.parse(m[2])]);
  };
  const admin = read("es.admin.ts");
  const publicText = read("es.public.ts")
    .map(([, v]) => v)
    .join("\n");
  return {
    keys: admin.map(([k]) => k),
    values: [
      ...new Set(
        admin
          .map(([, v]) => v)
          .filter((v) => v.length >= 12 && !publicText.includes(v)),
      ),
    ],
  };
}

/**
 * @param {string} clientDir build/client
 * @param {{ literals?: string[] }} [options] extra literal strings that must not appear outside the admin dir
 */
export function checkBundles(clientDir, { literals = [] } = {}) {
  const problems = [];
  if (!existsSync(clientDir) || !statSync(clientDir).isDirectory()) {
    return {
      ok: false,
      problems: [`client directory not found: ${clientDir}`],
    };
  }
  const adminDir = path.join(clientDir, ADMIN_DIR);
  const adminJs = existsSync(adminDir)
    ? [...walk(adminDir)].filter((f) => f.endsWith(".js"))
    : [];
  if (adminJs.length === 0) {
    problems.push(
      `${ADMIN_DIR}/ is missing or empty: admin chunks were not split out`,
    );
  }
  for (const file of walk(clientDir)) {
    const rel = path.relative(clientDir, file).split(path.sep).join("/");
    if (rel.startsWith(`${ADMIN_DIR}/`) || BINARY.test(rel)) continue;
    const text = readFileSync(file, "utf8");
    const isManifest = MANIFEST.test(rel);
    for (const m of MARKERS) {
      if (isManifest && MANIFEST_EXEMPT.has(m.name)) continue;
      if (m.regex.test(text)) problems.push(`${rel}: contains ${m.name}`);
    }
    for (const lit of literals) {
      if (text.includes(lit))
        problems.push(`${rel}: contains an admin dictionary text`);
    }
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

export function main(argv = process.argv.slice(2)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = path.resolve(
    argv[0] ?? path.join(here, "..", "build", "client"),
  );
  const { keys, values } = adminDictionaryKeys(
    path.join(here, "..", "app", "i18n"),
  );
  const { ok, problems } = checkBundles(clientDir, {
    literals: [...keys.map((k) => k), ...values],
  });
  if (!ok) {
    console.error(
      "check-bundles: admin-only code found outside admin-assets/:",
    );
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  console.log(`check-bundles: ok (${clientDir})`);
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}
