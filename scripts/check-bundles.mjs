// Guard: admin-only code must live only under build/client/admin-assets.
// Run after `pnpm build` (CI does). Exits 1 when any file outside that
// directory carries an admin-only marker, or when the directory is empty.
//   node scripts/check-bundles.mjs [clientDir]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const ADMIN_DIR = "admin-assets";

const Q = "[`\"']";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(HERE, "..", "app");

/**
 * Form/action intents, read from the admin sources themselves (so the list
 * cannot rot): `name="intent" value="x"`, `intent="x"`, `intent: "x"`,
 * `intent === "x"`.
 */
export function adminIntents(appDir = APP_DIR) {
  const files = [];
  const routes = path.join(appDir, "routes");
  for (const f of readdirSync(routes))
    if (/^(admin|api\.admin).*\.tsx$/.test(f)) files.push(path.join(routes, f));
  const comps = path.join(appDir, "components", "admin");
  // Recursive: editor sections live in components/admin/gallery-edit/.
  for (const f of readdirSync(comps, { recursive: true }))
    if (String(f).endsWith(".tsx")) files.push(path.join(comps, String(f)));
  const found = new Set();
  const patterns = [
    /name="intent"\s+value="([A-Za-z]+)"/g,
    /\bintent="([A-Za-z]+)"/g,
    /\bintent:\s*"([A-Za-z]+)"/g,
    /\bintent\s*===\s*"([A-Za-z]+)"/g,
  ];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const re of patterns)
      for (const m of src.matchAll(re)) found.add(m[1]);
  }
  if (found.size === 0) {
    throw new Error("check-bundles: no admin intents found in app/ sources");
  }
  return [...found].sort();
}

/**
 * Distinctive strings that only admin code contains. Every marker is a string
 * that survives minification (i18n keys, URLs, intent values), and
 * `calibrate()` proves each one still matches the real admin bundle.
 * `calibration: "build"` means the marker is only expected somewhere in the
 * build (not necessarily inside admin-assets/).
 */
const INTENTS = adminIntents().join("|");

export const MARKERS = [
  {
    name: "admin dictionary key",
    regex: /[`"']admin\.[A-Za-z]+\.[A-Za-z_.]*[A-Za-z_][`"']/,
  },
  { name: "admin asset path", regex: /admin-assets/, calibration: "build" },
  { name: "admin page path", regex: /[`"']\/admin\/(?:setup|google\/)/ },
  {
    name: "admin form intent",
    regex: new RegExp(
      `name:${Q}intent${Q},\\s*value:${Q}(?:${INTENTS})${Q}|\\bintent:${Q}(?:${INTENTS})${Q}`,
    ),
  },
];

// React Router's route manifest lists every route (admin ones included) and
// where its chunk lives: names only, no code. It is exempt from the markers
// that merely name admin routes/files.
const MANIFEST = /^assets\/manifest-[0-9a-f]+\.js$/;
const MANIFEST_EXEMPT = new Set([
  "admin dictionary key",
  "admin asset path",
  "admin page path",
]);
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
    const entries = [...src.matchAll(DICT_ENTRY)].map((m) => [
      m[1],
      JSON.parse(m[2]),
    ]);
    // Format drift (quote style, multi-line values) must not silently shrink
    // what the guard covers: every line that looks like an admin key counts.
    const expected = (src.match(/^\s*["'`]admin\./gm) ?? []).length;
    if (entries.length === 0 || entries.length < expected) {
      throw new Error(
        `check-bundles: parsed ${entries.length} of ${expected} admin keys in ${file}; update DICT_ENTRY`,
      );
    }
    return entries;
  };
  // The help (T6.57) and wizard (T6.58) texts live in their own admin-only dictionary files.
  const admin = [
    ...read("es.admin.ts"),
    ...read("es.help.ts"),
    ...read("es.wizard.ts"),
  ];
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
      `${ADMIN_DIR}/ is missing or empty; rebuild (admin chunks were not split out)`,
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

/**
 * Every marker must match at least one built file (inside admin-assets/, or
 * anywhere for `calibration: "build"`), otherwise it can never fail and the
 * guard is blind to what it claims to cover.
 */
export function calibrate(clientDir, markers = MARKERS) {
  const adminDir = path.join(clientDir, ADMIN_DIR);
  const read = (dir) =>
    existsSync(dir)
      ? [...walk(dir)]
          .filter((f) => !BINARY.test(f))
          .map((f) => readFileSync(f, "utf8"))
      : [];
  const adminTexts = read(adminDir);
  const allTexts = read(clientDir);
  return markers
    .filter(
      (m) =>
        !(m.calibration === "build" ? allTexts : adminTexts).some((t) =>
          m.regex.test(t),
        ),
    )
    .map((m) => `marker matches nothing: ${m.name}`);
}

export function main(argv = process.argv.slice(2)) {
  const here = HERE;
  const clientDir = path.resolve(
    argv[0] ?? path.join(here, "..", "build", "client"),
  );
  const { keys, values } = adminDictionaryKeys(
    path.join(here, "..", "app", "i18n"),
  );
  const { ok, problems } = checkBundles(clientDir, {
    literals: [...keys.map((k) => k), ...values],
  });
  const stale = calibrate(clientDir);
  if (stale.length > 0) {
    console.error("check-bundles: guard is blind:");
    for (const p of stale) console.error(`  - ${p}`);
    return 1;
  }
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
