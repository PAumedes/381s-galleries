import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = ["setup", "deploy"].map((n) => [
  n,
  readFileSync(`.github/workflows/${n}.yml`, "utf8"),
]);

describe("T6 workflow hardening", () => {
  for (const [n, y] of files) {
    it(`${n}.yml: secrets are not in job-level env (visible to install scripts and third-party actions)`, () => {
      // job-level env is indented 4 spaces; step-level env 8+.
      const jobEnv = /^ {4}env:\n((?: {6}\S.*\n)+)/m.exec(y);
      expect(jobEnv?.[1] ?? "").not.toMatch(/secrets\./);
    });
    it(`${n}.yml: third-party actions pinned to a commit SHA`, () => {
      const uses = [...y.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
      // local actions (./...) are in-repo code, not third-party
      for (const u of uses.filter((x) => !x.startsWith("./")))
        expect(u).toMatch(/@[0-9a-f]{40}$/);
    });
  }
});

describe("T6 composite setup action hardening", () => {
  const y = readFileSync(".github/actions/setup/action.yml", "utf8");
  it("third-party actions are pinned to a full commit SHA", () => {
    const uses = [...y.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses.filter((x) => !x.startsWith("./")))
      expect(u).toMatch(/@[0-9a-f]{40}$/);
  });
  it("installs with a frozen lockfile", () => {
    expect(y).toMatch(/^\s*- run: pnpm install --frozen-lockfile$/m);
  });
});
