import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(".");
const OWNER = "5aa33a23-9b94-45dd-a3b8-11305cd8affb";
const FORK = "11111111-2222-3333-4444-555555555555";

function sandbox(wrangler) {
  const d = mkdtempSync(path.join(tmpdir(), "fk4-"));
  mkdirSync(path.join(d, "scripts"));
  cpSync(path.join(REPO, "scripts"), path.join(d, "scripts"), {
    recursive: true,
  });
  writeFileSync(path.join(d, "wrangler.jsonc"), wrangler);
  return d;
}
function runScript(d, env) {
  return spawnSync("node", ["scripts/check-fork-config.mjs"], {
    cwd: d,
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  });
}
const cfg = (id, extra = "") =>
  `{\n  "d1_databases": [\n    { "binding": "DB", "database_name": "x", "database_id": "${id}" }${extra}\n  ]\n}\n`;

describe("fork4: owner never blocked", () => {
  const owner = readFileSync(path.join(REPO, "wrangler.jsonc"), "utf8");
  it.each([
    "PAumedes/381s-galleries",
    "paumedes/381s-galleries",
    "PAUMEDES/381S-GALLERIES",
    " PAumedes/381s-galleries \n",
    "",
    undefined,
  ])("committed wrangler.jsonc + GITHUB_REPOSITORY=%j passes", (r) => {
    const d = sandbox(owner);
    const res = runScript(d, r === undefined ? {} : { GITHUB_REPOSITORY: r });
    expect(res.status).toBe(0);
  });
  it("deploy step executed as in the workflow passes for the owner and reaches the later checks", () => {
    const wf = readFileSync(
      path.join(REPO, ".github/workflows/deploy.yml"),
      "utf8",
    );
    const run = /- name: Deploy[\s\S]*?run: \|\n((?: {10}.*\n?)+)/
      .exec(wf)[1]
      .replace(/^ {10}/gm, "");
    const d = sandbox(owner);
    const bin = path.join(d, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "pnpm"), "#!/bin/sh\necho PNPM-RAN\n", {
      mode: 0o755,
    });
    const go = (repo) =>
      spawnSync("bash", ["-e", "-c", run], {
        cwd: d,
        encoding: "utf8",
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          GITHUB_REPOSITORY: repo,
          CLOUDFLARE_API_TOKEN: "t",
          CLOUDFLARE_ACCOUNT_ID: "a",
        },
      });
    expect(go("PAumedes/381s-galleries").stdout).toContain("PNPM-RAN");
    const f = go("someone/381s-galleries");
    expect(f.status).not.toBe(0);
    expect(f.stdout).not.toContain("PNPM-RAN");
  });
  it("setup.yml and ci.yml do not invoke the guard", () => {
    for (const f of ["setup.yml", "ci.yml"])
      expect(
        readFileSync(path.join(REPO, ".github/workflows", f), "utf8"),
      ).not.toContain("check-fork-config");
  });
});

describe("fork4: fork bypasses", () => {
  const blocked = (config, repo = "someone/381s-galleries") =>
    runScript(sandbox(config), { GITHUB_REPOSITORY: repo }).status !== 0;
  it("blocks fork repo names that merely contain the owner name", () => {
    for (const r of [
      "PAumedes/381s-galleries-fork",
      "evilPAumedes/381s-galleries",
      "x/PAumedes/381s-galleries",
      "PAumedes/381s-galleries2",
    ])
      expect(blocked(cfg(OWNER), r), r).toBe(true);
  });
  it("blocks when the id is a commented decoy plus real owner id", () => {
    expect(
      blocked(
        `{ // "database_id": "${FORK}"\n "d1_databases":[{"database_id":"${OWNER}"}]}`,
      ),
    ).toBe(true);
    expect(
      blocked(
        `{ /* "database_id": "${OWNER}" */ "d1_databases":[{"database_id":"${FORK}"}]}`,
      ),
    ).toBe(false);
  });
  it("blocks CRLF / BOM / trailing comma configs", () => {
    expect(blocked("﻿" + cfg(OWNER).replace(/\n/g, "\r\n"))).toBe(true);
  });
  it("blocks an uppercase owner id (D1 ids are case-insensitive UUIDs)", () => {
    expect(blocked(cfg(OWNER.toUpperCase()))).toBe(true);
  });
  it("blocks an owner id with surrounding whitespace", () => {
    expect(blocked(cfg(` ${OWNER} `))).toBe(true);
  });
  it("blocks when the owner id is in a second d1 entry (guard only reads the first)", () => {
    expect(
      blocked(
        cfg(FORK, `,\n    { "binding": "DB2", "database_id": "${OWNER}" }`),
      ),
    ).toBe(true);
  });
});

describe("fork4: robustness", () => {
  it("malformed / missing-d1 config never crashes with a stack trace", () => {
    for (const c of ["{ not json", "{}", ""]) {
      const r = runScript(sandbox(c), { GITHUB_REPOSITORY: "a/b" });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toMatch(/at .*\(/);
    }
  });
  it("missing wrangler.jsonc gives a clean message, not a stack trace", () => {
    const d = sandbox("{}");
    spawnSync("rm", [path.join(d, "wrangler.jsonc")]);
    const r = runScript(d, { GITHUB_REPOSITORY: "a/b" });
    expect(r.stderr).not.toMatch(/at .*\(/);
  });
  it("error output uses the ::error:: annotation on a single line", () => {
    const r = runScript(sandbox(cfg(OWNER)), { GITHUB_REPOSITORY: "a/b" });
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
    expect(r.stdout).toMatch(/^::error::/);
  });
});
