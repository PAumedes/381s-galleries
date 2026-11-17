import process from "node:process";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/setup-cloudflare.mjs");
const REAL = "11111111-2222-3333-4444-555555555555";
const ZERO = "00000000-0000-0000-0000-000000000000";

// Fake `pnpm`: records args + stdin as JSON lines, prints canned output.
const FAKE = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
let stdin = "";
try { stdin = fs.readFileSync(0, "utf8"); } catch {}
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, stdin }) + "\\n");
const line = args.join(" ");
if (process.env.FAKE_FAIL && line.includes(process.env.FAKE_FAIL)) {
  process.stderr.write("boom\\n");
  process.exit(1);
}
if (line.includes("d1 list")) console.log("▲ [WARNING] hi\\n" + JSON.stringify([{ name: "381s-galleries", uuid: "${REAL}" }]));
else if (line.includes("r2 bucket list")) console.log("name: 381s-galleries-cache");
else if (line.includes("secret list")) console.log("[]");
process.exit(0);
`;

function run(extraEnv = {}, withCreds = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "sub-"));
  const bin = path.join(dir, "bin");
  spawnSync("mkdir", [bin]);
  writeFileSync(path.join(bin, "pnpm"), FAKE);
  chmodSync(path.join(bin, "pnpm"), 0o755);
  writeFileSync(
    path.join(dir, "wrangler.jsonc"),
    `{ "d1_databases": [ { "database_name": "381s-galleries", "database_id": "${ZERO}" } ] }`,
  );
  const log = path.join(dir, "calls.log");
  writeFileSync(log, "");
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      FAKE_LOG: log,
      ...(withCreds
        ? { CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acc" }
        : {}),
      GOOGLE_CLIENT_ID: "gid-value-AAA",
      GOOGLE_CLIENT_SECRET: "gsecret-value-BBB",
      ADMIN_EMAIL: "me@example.com",
      ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      ACCESS_AUD: "aud-value-CCC",
      ...extraEnv,
    },
  });
  const calls = readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return { r, calls, dir };
}

describe("setup-cloudflare.mjs as a subprocess", () => {
  it("exits 0 and sends secrets via stdin only, never in args or output", () => {
    const { r, calls, dir } = run();
    expect(r.status).toBe(0);
    const bulk = calls.find((c) => c.args.join(" ").includes("secret bulk"));
    expect(bulk).toBeDefined();
    const payload = JSON.parse(bulk.stdin);
    expect(payload.GOOGLE_CLIENT_SECRET).toBe("gsecret-value-BBB");
    expect(Object.keys(payload)).toEqual(
      expect.arrayContaining([
        "SESSION_SECRET",
        "DOWNLOAD_SECRET",
        "TOKEN_KEY",
      ]),
    );
    const values = Object.values(payload);
    for (const c of calls)
      for (const a of c.args)
        for (const v of values) expect(a).not.toContain(v);
    const out = r.stdout + r.stderr;
    for (const v of values) expect(out).not.toContain(v);
    expect(readFileSync(path.join(dir, "wrangler.jsonc"), "utf8")).toContain(
      REAL,
    );
  });

  it("exits 1 without Cloudflare credentials and runs no wrangler command", () => {
    const { r, calls } = run({}, false);
    expect(r.status).toBe(1);
    expect(calls).toEqual([]);
    expect(r.stdout).toMatch(/::error::/);
  });

  it("exits 1 when deploy fails, before any secret command", () => {
    const { r, calls } = run({ FAKE_FAIL: "run deploy" });
    expect(r.status).toBe(1);
    expect(calls.some((c) => c.args.join(" ").includes("secret"))).toBe(false);
  });

  it("exits 1 when the secret upload fails", () => {
    const { r } = run({ FAKE_FAIL: "secret bulk" });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/::error::/);
  });
});
