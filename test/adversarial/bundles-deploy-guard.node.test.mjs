import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the bundle guard runs on the deploy path, not only on PRs", () => {
  it("deploy.yml or the deploy script runs check:bundles after build", () => {
    const wf = readFileSync(".github/workflows/deploy.yml", "utf8");
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const deploy = pkg.scripts.deploy;
    expect(
      wf.includes("check:bundles") || deploy.includes("check:bundles"),
    ).toBe(true);
  });
});
