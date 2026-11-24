import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// T6.45: Deploy reuses the tested build. Structural invariants of deploy.yml
// (plain text; no YAML parser dependency).
const src = readFileSync(".github/workflows/deploy.yml", "utf8");

/** Text of each top-level job under `jobs:` keyed by job id. */
function jobs() {
  const body = src.slice(src.indexOf("\njobs:\n") + 6);
  const out = {};
  let id = null;
  for (const line of body.split("\n")) {
    const m = /^ {2}([a-z][\w-]*):\s*$/.exec(line);
    if (m) {
      id = m[1];
      out[id] = "";
    } else if (id) out[id] += line + "\n";
  }
  return out;
}

const GUARD = "if: github.ref == 'refs/heads/main'";
/** Non-comment lines only (comments may mention commands and keywords). */
const codeLines = (text) => text.split("\n").filter((l) => !/^\s*#/.test(l));
const code = codeLines(src).join("\n");

const needsOf = (text) => {
  const m = /^ {4}needs:\s*\[([^\]]*)\]/m.exec(text);
  return m ? m[1].split(",").map((s) => s.trim()) : [];
};

describe("T6.45 deploy workflow", () => {
  const j = jobs();

  it("has lint, typecheck, build, test and deploy jobs", () => {
    expect(Object.keys(j).sort()).toEqual(
      ["build", "deploy", "lint", "test", "typecheck"].sort(),
    );
  });

  it("deploy needs every check job", () => {
    expect(needsOf(j.deploy ?? "").sort()).toEqual(
      ["build", "lint", "test", "typecheck"].sort(),
    );
  });

  it("the check jobs do not need each other (they run in parallel)", () => {
    for (const id of ["lint", "typecheck", "build", "test"]) {
      expect(needsOf(j[id] ?? "x")).toEqual([]);
    }
  });

  it("tests run in 3 shards without fail-fast", () => {
    expect(j.test).toContain("shard: [1, 2, 3]");
    expect(j.test).toContain("fail-fast: false");
    expect(j.test).toContain("--shard=${{ matrix.shard }}/3");
  });

  it("uses the shared setup action and keeps no serial Checks step", () => {
    expect(src).not.toMatch(/pnpm lint && pnpm typecheck/);
    for (const id of Object.keys(j)) {
      expect(j[id]).toContain("uses: ./.github/actions/setup");
    }
  });

  it("secrets appear only in the deploy job (and only in a step env)", () => {
    for (const id of ["lint", "typecheck", "build", "test"]) {
      expect(j[id] ?? "x").not.toMatch(/secrets\./);
    }
    expect(j.deploy ?? "").toMatch(/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\./);
    expect(src.match(/secrets\./g)?.length).toBe(2);
    expect(src.split("\njobs:\n")[0]).not.toMatch(/secrets\./);
  });

  it("keeps the serial concurrency group and minimal permissions", () => {
    expect(src).toMatch(
      /concurrency:\n {2}group: cloudflare\n {2}cancel-in-progress: false/,
    );
    expect(code).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(code.match(/^\s*permissions:/gm)?.length).toBe(1);
    expect(code).not.toMatch(/(write|id-token)/);
  });

  it("build uploads the artifact deploy downloads (same name, hidden files)", () => {
    const up =
      /upload-artifact@[0-9a-f]{40} # v\S+\n\s+with:\n([\s\S]*?)(?=\n {6}- |\n*$)/.exec(
        j.build ?? "",
      );
    const down =
      /download-artifact@[0-9a-f]{40} # v\S+\n\s+with:\n([\s\S]*?)(?=\n {6}- |\n*$)/.exec(
        j.deploy ?? "",
      );
    expect(up).not.toBeNull();
    expect(down).not.toBeNull();
    const name = (s) => /name: (\S+)/.exec(s)?.[1];
    expect(name(up?.[1] ?? "")).toBeTruthy();
    expect(name(up?.[1] ?? "")).toBe(name(down?.[1] ?? ""));
    expect(up?.[1]).toContain("include-hidden-files: true");
    expect(up?.[1]).toContain("build/");
    expect(up?.[1]).toContain(".wrangler/deploy/config.json");
    expect(up?.[1]).toContain("if-no-files-found: error");
  });

  it("build job checks bundles before uploading", () => {
    const b = j.build ?? "";
    expect(b.indexOf("pnpm build")).toBeGreaterThan(-1);
    expect(b.indexOf("pnpm check:bundles")).toBeGreaterThan(
      b.indexOf("pnpm build"),
    );
    expect(b.indexOf("upload-artifact")).toBeGreaterThan(
      b.indexOf("check:bundles"),
    );
  });

  it("deploy applies migrations then wrangler deploy, without rebuilding", () => {
    const d = j.deploy ?? "";
    expect(d).toContain("check-fork-config.mjs");
    expect(d).toContain("Run the Setup workflow first");
    expect(d).toContain("Faltan CLOUDFLARE_API_TOKEN");
    expect(d).not.toMatch(/pnpm run deploy|pnpm build|react-router build/);
    const cmds = codeLines(d).map((l) => l.trim());
    const mig = cmds.indexOf(
      "pnpm exec wrangler d1 migrations apply DB --remote",
    );
    const dep = cmds.indexOf("pnpm exec wrangler deploy");
    expect(mig).toBeGreaterThan(-1);
    expect(dep).toBeGreaterThan(mig);
  });

  it("pinned third-party actions use full SHAs", () => {
    for (const m of src.matchAll(/uses: (\S+)/g)) {
      if (m[1].startsWith("./")) continue;
      expect(m[1]).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("every job runs only on main (workflow_dispatch from another branch does nothing)", () => {
    for (const id of Object.keys(j)) {
      const ifs = j[id].match(/^ {4}if:.*$/gm) ?? [];
      expect(
        ifs.map((l) => l.trim()),
        id,
      ).toEqual([GUARD]);
    }
  });

  it("nothing can fail open: no continue-on-error, no `|| true`", () => {
    expect(code).not.toMatch(/continue-on-error/);
    expect(code).not.toMatch(/\|\|\s*true/);
  });

  it("deploy checks out the triggering sha (no `ref:` override)", () => {
    expect(j.deploy ?? "").not.toMatch(/^\s*ref:/m);
  });

  it("deploy skips (exit 0, notice) when main has moved past this sha, before migrations", () => {
    const cmds = codeLines(j.deploy ?? "").map((l) => l.trim());
    const ls = cmds.findIndex((l) =>
      l.includes("git ls-remote origin refs/heads/main"),
    );
    const cmp = cmds.findIndex(
      (l) => /\$GITHUB_SHA|github\.sha/.test(l) && l.includes("!="),
    );
    const mig = cmds.indexOf(
      "pnpm exec wrangler d1 migrations apply DB --remote",
    );
    expect(ls).toBeGreaterThan(-1);
    expect(cmp).toBeGreaterThan(ls);
    expect(cmds.slice(cmp, cmp + 4).join("\n")).toMatch(
      /::notice::[\s\S]*exit 0/,
    );
    expect(mig).toBeGreaterThan(cmp);
  });

  it("on: is exactly push to main plus workflow_dispatch", () => {
    const on = /^on:\n((?: {2}.*\n)+)/m.exec(src)?.[1];
    expect(on).toBe("  push:\n    branches: [main]\n  workflow_dispatch:\n");
  });

  it("still runs on push to main and manually", () => {
    expect(src).toContain("branches: [main]");
    expect(src).toContain("workflow_dispatch:");
  });
});
