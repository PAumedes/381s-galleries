import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MARKERS,
  adminDictionaryKeys,
  checkBundles,
} from "../../scripts/check-bundles.mjs";

function build(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "adv-bundles-"));
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(dir, rel);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
  return dir;
}

describe("check-bundles marker rot", () => {
  // Real admin forms use these intents (build/client/admin-assets has
  // intent:`cover`, `home`, `pin`) but ADMIN_INTENTS does not list them.
  for (const intent of ["cover", "home", "pin"]) {
    it(`flags a public chunk with an admin form intent:${intent}`, () => {
      const dir = build({
        "admin-assets/a.js": "x",
        "assets/leak.js": `fetch("/x",{body:{intent:\`${intent}\`}})`,
      });
      // the intent marker is the only thing that could catch it (no dict key)
      const r = checkBundles(dir);
      expect(r.ok).toBe(false);
    });
  }

  it("identifier markers can match minified output (each marker is exercised by the real build)", () => {
    const clientDir = path.resolve("build/client");
    if (!existsSync(clientDir)) return;
    const walk = (d) =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
      );
    const adminDir = path.join(clientDir, "admin-assets");
    const adminFiles = existsSync(adminDir) ? walk(adminDir) : [];
    // a stale or partial build must fail clearly, not crash with ENOENT
    expect(
      adminFiles.length,
      "admin-assets/ is missing or empty; rebuild (pnpm build)",
    ).toBeGreaterThan(0);
    const adminJs = adminFiles.map((f) => readFileSync(f, "utf8"));
    const dead = MARKERS.filter((m) =>
      ["adminAction", "requireAdmin"].includes(m.name),
    )
      .filter((m) => !adminJs.some((t) => m.regex.test(t)))
      .map((m) => m.name);
    // a marker that never matches even the admin bundle can never fail
    expect(dead).toEqual([]);
  });

  it("a stale build without admin-assets fails clearly (no ENOENT, never ok)", () => {
    const dir = build({ "assets/app.js": "console.log(1)" });
    const r = checkBundles(dir);
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toContain(
      "admin-assets/ is missing or empty; rebuild",
    );
  });

  it("refuses to pass silently when the dictionary format drifts (0 keys parsed)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "adv-i18n-"));
    const body = `export const esAdmin = {\n  'admin.nav.label': 'Administración de galerías',\n};\n`;
    writeFileSync(path.join(dir, "es.admin.ts"), body);
    writeFileSync(
      path.join(dir, "es.public.ts"),
      "export const esPublic = {};\n",
    );
    let keys;
    try {
      keys = adminDictionaryKeys(dir).keys;
    } catch {
      return; // throwing is the acceptable behaviour
    }
    expect(keys.length).toBeGreaterThan(0);
  });
});
