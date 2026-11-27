import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_DIR,
  MARKERS,
  adminDictionaryKeys,
  adminIntents,
  calibrate,
  checkBundles,
} from "../../scripts/check-bundles.mjs";

const SCRIPT = path.resolve("scripts/check-bundles.mjs");

let dir;
function put(rel, content) {
  const file = path.join(dir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
function clean() {
  put("assets/entry.client-abc.js", "export const a = `hello`;");
  put("assets/root-abc.css", "body{margin:0}");
  put("assets/font.woff2", "\u0000\u0001binary admin-assets");
  put("index.html", "<html></html>");
  put(`${ADMIN_DIR}/admin.setup-abc.js`, "const k = `admin.nav.label`;");
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bundles-"));
  clean();
});

describe("checkBundles", () => {
  it("passes a clean build", () => {
    expect(checkBundles(dir)).toEqual({ ok: true, problems: [] });
  });

  it("admin markers are fine inside the admin directory", () => {
    put(`${ADMIN_DIR}/admin.g._id-x.js`, " adminAction(); `admin.nav.label`");
    expect(checkBundles(dir).ok).toBe(true);
  });

  const leaks = {
    "dictionary key": "x = {`admin.setup.title`: 1}",
    "dictionary key (double quotes)":
      'x = {"admin.nav.label":"Administración"}',
    "admin asset dir reference": 'import("/admin-assets/admin-abc.js")',
    "admin page path": 'location.href = "/admin/setup"',
    "admin intent derived from sources (cover)": "{intent:`cover`}",
    "admin form intent": "{name:`intent`,value:`reorder`}",
    "admin form intent (quotes)": '{name:"intent",value:"disconnect"}',
    "admin result intent": "{data:t,intent:`studio`}",
  };
  for (const [name, code] of Object.entries(leaks)) {
    it(`fails on a public chunk with: ${name}`, () => {
      put("assets/shared-1.js", code);
      const r = checkBundles(dir);
      expect(r.ok).toBe(false);
      expect(r.problems.some((p) => p.includes("assets/shared-1.js"))).toBe(
        true,
      );
    });
  }

  it("scans css, html and every nested file outside the admin dir", () => {
    put("assets/nested/deep/a.css", '/* "/admin/setup" */');
    put("page.html", "<script>x('admin.nav.label')</script>");
    const r = checkBundles(dir);
    expect(r.problems.join("\n")).toContain("assets/nested/deep/a.css");
    expect(r.problems.join("\n")).toContain("page.html");
  });

  it("does not print the matched code, only file and marker name", () => {
    put("assets/shared-1.js", 'const secret = "/admin/setup/very-secret-path"');
    const r = checkBundles(dir);
    expect(r.problems.join("\n")).not.toContain("very-secret-path");
  });

  it("exempts only React Router's route manifest", () => {
    put(
      "assets/manifest-0a1b2c3d.js",
      'window.__reactRouterManifest={"routes":{"admin.setup":{"module":"/admin-assets/admin.setup-x.js"}}}',
    );
    expect(checkBundles(dir).ok).toBe(true);
    put("assets/manifest-evil.js", 'import("/admin-assets/admin.setup-x.js")');
    expect(checkBundles(dir).ok).toBe(false);
  });

  it("the manifest is still checked for admin dictionary text", () => {
    put("assets/manifest-0a1b2c3d.js", 'x="Guardar punto focal"');
    expect(checkBundles(dir, { literals: ["Guardar punto focal"] }).ok).toBe(
      false,
    );
  });

  it("fails when the admin directory is missing", () => {
    const d = mkdtempSync(path.join(tmpdir(), "bundles-"));
    mkdirSync(path.join(d, "assets"));
    writeFileSync(path.join(d, "assets/a.js"), "1");
    const r = checkBundles(d);
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(/admin-assets.*(empty|missing)/);
  });

  it("fails when the admin directory has no .js file", () => {
    const d = mkdtempSync(path.join(tmpdir(), "bundles-"));
    mkdirSync(path.join(d, ADMIN_DIR));
    writeFileSync(path.join(d, ADMIN_DIR, "readme.txt"), "x");
    expect(checkBundles(d).ok).toBe(false);
  });

  it("fails when the client directory does not exist", () => {
    expect(checkBundles(path.join(dir, "nope")).ok).toBe(false);
  });

  it("extra literal markers (admin dictionary values) are enforced", () => {
    put("assets/a.js", "const t = `Guardar punto focal`");
    expect(checkBundles(dir).ok).toBe(true);
    const r = checkBundles(dir, { literals: ["Guardar punto focal"] });
    expect(r.ok).toBe(false);
  });

  it("MARKERS are named", () => {
    expect(MARKERS.length).toBeGreaterThanOrEqual(4);
    for (const m of MARKERS) {
      expect(typeof m.name).toBe("string");
      expect(m.regex).toBeInstanceOf(RegExp);
    }
  });
});

describe("adminIntents", () => {
  it("is derived from the admin sources", () => {
    const intents = adminIntents();
    for (const i of ["cover", "home", "pin", "focus", "sync", "root"])
      expect(intents).toContain(i);
  });
});

describe("adminDictionaryKeys", () => {
  it("reads the keys and the Spanish values of the admin dictionary", () => {
    const { keys, values } = adminDictionaryKeys(path.resolve("app/i18n"));
    expect(keys).toContain("admin.nav.label");
    expect(keys.every((k) => k.startsWith("admin."))).toBe(true);
    expect(values).toContain("Administración");
    expect(keys.length).toBeGreaterThan(300);
  });
  it("T6.57: also guards the help texts (own dictionary file)", () => {
    const { keys, values } = adminDictionaryKeys(path.resolve("app/i18n"));
    expect(keys).toContain("admin.help.title");
    expect(keys).toContain("admin.help.albums-publish.q");
    expect(values).toContain("¿Cómo publico un álbum?");
  });
});

describe("calibrate", () => {
  it("reports markers that match nothing in admin-assets", () => {
    const stale = calibrate(dir);
    expect(stale.join("\n")).toContain(
      "marker matches nothing: admin page path",
    );
  });
  it("is silent when every marker is present", () => {
    putFullAdmin();
    expect(calibrate(dir)).toEqual([]);
  });
});

function putFullAdmin() {
  put(
    `${ADMIN_DIR}/admin.full-x.js`,
    'a(`admin.nav.label`);b("/admin/setup");c({name:`intent`,value:`reorder`});import("/admin-assets/x.js")',
  );
}

describe("CLI", () => {
  it("exits 1 when a marker matches nothing (blind guard)", () => {
    const r = spawnSync("node", [SCRIPT, dir], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("marker matches nothing");
  });
  it("exits 0 on a clean build", () => {
    putFullAdmin();
    const r = spawnSync("node", [SCRIPT, dir], { encoding: "utf8" });
    expect(r.status).toBe(0);
  });
  it("exits 1 and names the file on a leak", () => {
    putFullAdmin();
    put("assets/shared-1.js", 'location.href = "/admin/setup"');
    const r = spawnSync("node", [SCRIPT, dir], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("assets/shared-1.js");
  });
});
