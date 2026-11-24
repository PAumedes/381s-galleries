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

const ciSrc = readFileSync(".github/workflows/ci.yml", "utf8");
function ciJobs() {
  const body = ciSrc.slice(ciSrc.indexOf("\njobs:\n") + 6);
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

/** Parsed shard plan of a `test` job: matrix list and the N in flag and name. */
function shardPlan(text) {
  const lines = text.split("\n").filter((l) => !/^\s*#/.test(l));
  const body = lines.join("\n");
  const matrix = lines.filter((l) => /^\s+shard:/.test(l));
  expect(matrix, "exactly one shard: matrix line").toHaveLength(1);
  const list = /shard:\s*\[([^\]]*)\]/
    .exec(matrix[0])[1]
    .split(",")
    .map((x) => Number(x.trim()));
  const flags = [
    ...body.matchAll(/vitest run --shard=\$\{\{ matrix\.shard \}\}\/(\d+)/g),
  ];
  expect(flags, "exactly one vitest shard command").toHaveLength(1);
  expect(body.match(/vitest run/g), "no other vitest run").toHaveLength(1);
  const flagTotal = Number(flags[0][1]);
  const nameTotal = Number(/\$\{\{ matrix\.shard \}\}\/(\d+)\)/.exec(body)[1]);
  return { list, total: list.length, flagTotal, nameTotal };
}

/** Keys of the `strategy:` block as `path` strings (indent-based). */
function strategyKeys(text) {
  const lines = text.split("\n").filter((l) => !/^\s*#/.test(l));
  const i = lines.findIndex((l) => /^ {4}strategy:\s*$/.test(l));
  if (i < 0) return [];
  const keys = [];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() && !/^ {5,}/.test(l)) break;
    const m = /^( {6}| {8})([\w-]+):/.exec(l);
    if (m) keys.push(m[1].length === 6 ? m[2] : `matrix.${m[2]}`);
  }
  return keys;
}

const noComments = (t) =>
  t
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

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

  it("tests run in >=3 shards without fail-fast", () => {
    expect(j.test).toContain("fail-fast: false");
    expect(shardPlan(j.test).total).toBeGreaterThanOrEqual(3);
  });

  // Every test file lands in exactly one shard (vitest partitions the file
  // list by --shard=i/N) only if the matrix is exactly 1..N and N matches the
  // flag. Both workflows must use the same plan.
  it.each([
    ["deploy.yml", () => j.test],
    ["ci.yml", () => ciJobs().test],
  ])("%s shard matrix is exactly 1..N and matches --shard=i/N", (_n, get) => {
    const { list, total, flagTotal, nameTotal } = shardPlan(get());
    expect(list).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(flagTotal).toBe(total);
    expect(nameTotal).toBe(total);
    expect(total).toBe(shardPlan(j.test).total);
  });

  it.each([
    ["deploy.yml", () => j.test],
    ["ci.yml", () => ciJobs().test],
  ])(
    "%s test job: only fail-fast false and matrix.shard, no include/exclude, no step-level if",
    (_n, get) => {
      const t = noComments(get());
      expect(strategyKeys(t).sort()).toEqual([
        "fail-fast",
        "matrix",
        "matrix.shard",
      ]);
      expect(t).toMatch(/^ {6}fail-fast: false\s*$/m);
      expect(t).not.toMatch(/\b(include|exclude):/);
      expect(t).not.toMatch(/^ {6,}(- )?if:/m);
      expect(t).not.toMatch(/continue-on-error|\|\|\s*true/);
    },
  );

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

describe("T6.43 ci.yml structure", () => {
  const c = ciJobs();

  it("has exactly lint, typecheck, build, test, check", () => {
    expect(Object.keys(c).sort()).toEqual(
      ["build", "check", "lint", "test", "typecheck"].sort(),
    );
  });

  it("test shard count is at least 3", () => {
    expect(shardPlan(c.test).total).toBeGreaterThanOrEqual(3);
  });

  it("lint, typecheck, build cannot fail open or be skipped", () => {
    for (const id of ["lint", "typecheck", "build"]) {
      const t = noComments(c[id]);
      expect(t, id).not.toMatch(/continue-on-error|\|\|\s*true/);
      expect(t, id).not.toMatch(/^ {4,}(- )?if:/m);
      expect(needsOf(t), id).toEqual([]);
    }
    expect(noComments(c.test)).not.toMatch(/^ {4,}(- )?if:/m);
    expect(needsOf(noComments(c.test))).toEqual([]);
  });

  it("check is the single gate: needs all four, always runs, requires success", () => {
    const t = noComments(c.check);
    expect(needsOf(t).sort()).toEqual(["build", "lint", "test", "typecheck"]);
    expect(t).toMatch(/^ {4}if: always\(\)\s*$/m);
    expect(t).not.toMatch(/continue-on-error|\|\|\s*true/);
    expect(t).toContain("RESULTS: ${{ join(needs.*.result, ' ') }}");
    expect(t).toContain("for r in $RESULTS; do");
    expect(t).toContain('if [ "$r" != "success" ]; then');
    expect(t).toMatch(/exit 1/);
  });

  it("check job keeps its branch-protection name (no name: override)", () => {
    expect(c.check).not.toMatch(/^ {4}name:/m);
  });
});
