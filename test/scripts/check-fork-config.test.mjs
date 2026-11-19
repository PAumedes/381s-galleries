import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  OWNER_DB_ID,
  OWNER_REPO,
  checkForkConfig,
  readDatabaseId,
} from "../../scripts/check-fork-config.mjs";

const SCRIPT = path.resolve("scripts/check-fork-config.mjs");
const ZERO = "00000000-0000-0000-0000-000000000000";
const FORK_ID = "11111111-2222-3333-4444-555555555555";
const cfg = (id) =>
  `{ // c "database_id": "x"\n "d1_databases": [ { "binding": "DB", "database_id": "${id}" } ] }`;

describe("T6.23 check-fork-config", () => {
  it("reads database_id ignoring comments", () => {
    expect(readDatabaseId(cfg(FORK_ID))).toBe(FORK_ID);
    expect(readDatabaseId("{}")).toBeNull();
  });
  it("owner repo with owner id: ok (case-insensitive repo)", () => {
    expect(
      checkForkConfig({
        config: cfg(OWNER_DB_ID),
        repository: OWNER_REPO.toUpperCase(),
      }).ok,
    ).toBe(true);
  });
  it("fork repo with the owner's id: error naming Setup", () => {
    const r = checkForkConfig({
      config: cfg(OWNER_DB_ID),
      repository: "someone/381s-galleries",
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Setup/);
    expect(r.message).not.toContain(OWNER_DB_ID);
  });
  it("fork repo with its own id or the placeholder: ok", () => {
    for (const id of [FORK_ID, ZERO])
      expect(
        checkForkConfig({ config: cfg(id), repository: "someone/x" }).ok,
      ).toBe(true);
  });
  it("unknown repository (local run) is not blocked", () => {
    expect(
      checkForkConfig({ config: cfg(OWNER_DB_ID), repository: "" }).ok,
    ).toBe(true);
  });
  it("the committed wrangler.jsonc carries the owner id and passes as owner", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");
    expect(checkForkConfig({ config, repository: OWNER_REPO }).ok).toBe(true);
  });
  it("CLI exits 1 for a fork with the owner id, 0 otherwise", () => {
    const run = (repo) =>
      spawnSync("node", [SCRIPT], {
        env: { ...process.env, GITHUB_REPOSITORY: repo },
        encoding: "utf8",
      });
    expect(run(OWNER_REPO).status).toBe(0);
    const bad = run("someone/else");
    expect(bad.status).toBe(1);
    expect(bad.stdout + bad.stderr).toContain("::error::");
  });
  it("deploy.yml runs the guard before deploying", () => {
    const y = readFileSync(".github/workflows/deploy.yml", "utf8");
    expect(y).toContain("node scripts/check-fork-config.mjs");
    expect(y.indexOf("check-fork-config")).toBeLessThan(
      y.indexOf("pnpm run deploy"),
    );
  });
});
