import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const repo = process.cwd();
const read = (p) => readFileSync(path.join(repo, p), "utf8");

/** Run the guard tests against a mutated copy of the workflow files. */
function guardsPass(mutate) {
  const dir = mkdtempSync(path.join(tmpdir(), "ci2-mut-"));
  mkdirSync(path.join(dir, ".github/workflows"), { recursive: true });
  mkdirSync(path.join(dir, ".github/actions/setup"), { recursive: true });
  mkdirSync(path.join(dir, "t"), { recursive: true });
  const files = {
    ".github/workflows/deploy.yml": read(".github/workflows/deploy.yml"),
    ".github/workflows/ci.yml": read(".github/workflows/ci.yml"),
    ".github/workflows/setup.yml": read(".github/workflows/setup.yml"),
    ".github/actions/setup/action.yml": read(
      ".github/actions/setup/action.yml",
    ),
  };
  mutate(files);
  for (const [p, c] of Object.entries(files))
    writeFileSync(path.join(dir, p), c);
  for (const t of [
    "test/scripts/deploy-workflow.test.mjs",
    "test/scripts/adversarial/T6-workflow-hardening.test.mjs",
  ])
    cpSync(path.join(repo, t), path.join(dir, "t", path.basename(t)));
  symlinkSync(path.join(repo, "node_modules"), path.join(dir, "node_modules"));
  writeFileSync(
    path.join(dir, "vitest.config.mjs"),
    'export default { test: { include: ["t/*.test.mjs"] } };\n',
  );
  const r = spawnSync(
    path.join(repo, "node_modules/.bin/vitest"),
    ["run", "--root", dir],
    { cwd: dir, encoding: "utf8" },
  );
  return { ok: r.status === 0, out: r.stdout + r.stderr };
}

describe("T6.45 guard tests must catch realistic regressions", () => {
  it("baseline passes", () => {
    const r = guardsPass(() => {});
    expect(r.out).toContain("passed");
    expect(r.ok).toBe(true);
  });
  const cases = {
    "continue-on-error on the test job": (f) => {
      f[".github/workflows/deploy.yml"] = f[
        ".github/workflows/deploy.yml"
      ].replace(
        "    runs-on: ubuntu-latest\n    strategy:",
        "    runs-on: ubuntu-latest\n    continue-on-error: true\n    strategy:",
      );
    },
    "pnpm lint || true": (f) => {
      f[".github/workflows/deploy.yml"] = f[
        ".github/workflows/deploy.yml"
      ].replace("run: pnpm lint", "run: pnpm lint || true");
    },
    "deploy if: always()": (f) => {
      f[".github/workflows/deploy.yml"] = f[
        ".github/workflows/deploy.yml"
      ].replace(
        "    needs: [lint, typecheck, build, test]\n",
        "    needs: [lint, typecheck, build, test]\n    if: always()\n",
      );
    },
    "pull_request_target trigger": (f) => {
      f[".github/workflows/deploy.yml"] = f[
        ".github/workflows/deploy.yml"
      ].replace(
        "  workflow_dispatch:\n",
        "  workflow_dispatch:\n  pull_request_target:\n",
      );
    },
    "deploy checkout of a moving ref (not the tested sha)": (f) => {
      const y = f[".github/workflows/deploy.yml"];
      const i = y.indexOf("  deploy:\n");
      f[".github/workflows/deploy.yml"] =
        y.slice(0, i) +
        y
          .slice(i)
          .replace(
            /(actions\/checkout@\S+ # \S+\n)/,
            "$1        with:\n          ref: main\n",
          );
    },
    "unpinned third-party action inside the local composite action": (f) => {
      f[".github/actions/setup/action.yml"] = f[
        ".github/actions/setup/action.yml"
      ].replace(/pnpm\/action-setup@[0-9a-f]{40}/, "pnpm/action-setup@v6");
    },
    "frozen lockfile dropped in the composite action": (f) => {
      f[".github/actions/setup/action.yml"] = f[
        ".github/actions/setup/action.yml"
      ].replace(" --frozen-lockfile", "");
    },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    it(`catches: ${name}`, () => {
      const r = guardsPass(mutate);
      expect(r.ok, "mutation survived (all guard tests still pass)").toBe(
        false,
      );
    });
  }
});

describe("T6.45 deploy only from main", () => {
  it("deploy job refuses workflow_dispatch from a non-main ref", () => {
    const y = read(".github/workflows/deploy.yml");
    // any branch can be selected in 'Run workflow'; secrets then reach that branch's code
    expect(y).toMatch(
      /github\.ref\s*==\s*'refs\/heads\/main'|github\.ref_name\s*==\s*'main'/,
    );
  });
});
