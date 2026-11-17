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
      for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
    });
  }
});
