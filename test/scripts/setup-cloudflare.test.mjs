import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ensureD1,
  ensureR2,
  main,
  parseBucketNames,
} from "../../scripts/setup-cloudflare.mjs";

const ZERO = "00000000-0000-0000-0000-000000000000";
const REAL = "11111111-2222-3333-4444-555555555555";
const CONFIG = `{
  // keep me
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "381s-galleries",
      // Placeholder comment
      "database_id": "${ZERO}", // trailing
    },
  ],
}
`;
const PROVIDED = {
  GOOGLE_CLIENT_ID: "gid-value-AAA",
  GOOGLE_CLIENT_SECRET: "gsecret-value-BBB",
  ADMIN_EMAIL: "me@example.com",
  ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
  ACCESS_AUD: "aud-value-CCC",
};
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });

/** Fake wrangler. state mutated by commands. */
function fake(opts = {}) {
  const st = {
    d1: opts.d1 ?? [{ name: "381s-galleries", uuid: REAL }],
    buckets: opts.buckets ?? ["381s-galleries-cache"],
    secrets: opts.secrets ?? [],
    calls: [],
    r2CreateFails: opts.r2CreateFails,
    failDeploy: opts.failDeploy,
  };
  const run = async (cmd, args, o = {}) => {
    const line = [cmd, ...args].join(" ");
    st.calls.push({ line, args, input: o.input });
    if (line.includes("d1 list")) return ok(JSON.stringify(st.d1));
    if (line.includes("d1 create")) {
      st.d1 = [{ name: "381s-galleries", uuid: REAL }];
      return ok("created (human output, ignore)");
    }
    if (line.includes("r2 bucket list"))
      return ok(
        "Listing buckets...\n" +
          st.buckets
            .map((b) => `name:           ${b}\ncreation_date:  2026-01-01`)
            .join("\n\n"),
      );
    if (line.includes("r2 bucket create")) {
      if (st.r2CreateFails)
        return { code: 1, stdout: "", stderr: st.r2CreateFails };
      st.buckets.push("381s-galleries-cache");
      return ok();
    }
    if (line.includes("run deploy"))
      return st.failDeploy ? { code: 1, stdout: "", stderr: "boom" } : ok();
    if (line.includes("secret list"))
      return ok(
        JSON.stringify(
          st.secrets.map((name) => ({ name, type: "secret_text" })),
        ),
      );
    if (line.includes("secret bulk")) return ok();
    if (line.includes("secret delete")) return ok();
    return ok();
  };
  return { run, st };
}

let cfg;
let logs;
const log = (m) => logs.push(m);
beforeEach(() => {
  cfg = path.join(mkdtempSync(path.join(tmpdir(), "setup-")), "wrangler.jsonc");
  writeFileSync(cfg, CONFIG);
  logs = [];
});

describe("ensureD1", () => {
  it("rewrites the placeholder id preserving comments and reports changed", async () => {
    const { run } = fake();
    const r = await ensureD1({ run, log, configPath: cfg });
    expect(r).toEqual({ id: REAL, changed: true });
    const out = readFileSync(cfg, "utf8");
    expect(out).toBe(CONFIG.replace(ZERO, REAL));
    expect(out).toContain("// keep me");
  });
  it("reports unchanged when id already matches", async () => {
    writeFileSync(cfg, CONFIG.replace(ZERO, REAL));
    const { run, st } = fake();
    const r = await ensureD1({ run, log, configPath: cfg });
    expect(r.changed).toBe(false);
    expect(st.calls.some((c) => c.line.includes("d1 create"))).toBe(false);
  });
  it("creates when missing, then re-lists for the uuid", async () => {
    const { run, st } = fake({ d1: [{ name: "other", uuid: "x" }] });
    const r = await ensureD1({ run, log, configPath: cfg });
    const lines = st.calls.map((c) => c.line);
    expect(lines.filter((l) => l.includes("d1 list --json"))).toHaveLength(2);
    expect(lines.some((l) => l.includes("d1 create 381s-galleries"))).toBe(
      true,
    );
    expect(r.id).toBe(REAL);
    expect(readFileSync(cfg, "utf8")).toContain(REAL);
  });
  it("throws if the database is still missing after create", async () => {
    const { run } = fake({ d1: [] });
    const run2 = async (c, a, o) =>
      a.includes("create") ? ok() : run(c, a, o);
    await expect(
      ensureD1({ run: run2, log, configPath: cfg }),
    ).rejects.toThrow();
  });
  it("tolerates banner text before the JSON", async () => {
    const run = async (c, a) =>
      a.includes("list")
        ? ok(`warn line\n[{"name":"381s-galleries","uuid":"${REAL}"}]`)
        : ok();
    const r = await ensureD1({ run, log, configPath: cfg });
    expect(r.id).toBe(REAL);
  });
});

describe("ensureR2", () => {
  it("parseBucketNames reads labelled output", () => {
    expect(
      parseBucketNames(
        "Listing buckets...\nname:  a\ncreation_date: x\n\nname: b\n",
      ),
    ).toEqual(["a", "b"]);
  });
  it("does nothing when the bucket exists", async () => {
    const { run, st } = fake();
    expect(await ensureR2({ run, log })).toBe("present");
    expect(st.calls.some((c) => c.line.includes("bucket create"))).toBe(false);
  });
  it("creates when missing", async () => {
    const { run, st } = fake({ buckets: [] });
    expect(await ensureR2({ run, log })).toBe("created");
    expect(
      st.calls.some((c) =>
        c.line.includes("r2 bucket create 381s-galleries-cache"),
      ),
    ).toBe(true);
  });
  it("treats an already-exists error as success", async () => {
    const { run } = fake({
      buckets: [],
      r2CreateFails:
        "The bucket you tried to create already exists [code: 10004]",
    });
    expect(await ensureR2({ run, log })).toBe("present");
  });
  it("throws on other create errors", async () => {
    const { run } = fake({
      buckets: [],
      r2CreateFails: "Authentication error [code: 10000]",
    });
    await expect(ensureR2({ run, log })).rejects.toThrow();
  });
});

describe("main", () => {
  const baseEnv = { CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acc" };
  const go = (f, env = {}, extra = {}) =>
    main({
      run: f.run,
      env: { ...baseEnv, ...env },
      log,
      configPath: cfg,
      ...extra,
    });

  it("deploys before any secret command", async () => {
    const f = fake();
    await go(f, PROVIDED);
    const lines = f.st.calls.map((c) => c.line);
    const d = lines.findIndex((l) => l.includes("run deploy"));
    const s = lines.findIndex((l) => l.includes("secret "));
    expect(d).toBeGreaterThan(-1);
    expect(s).toBeGreaterThan(d);
    expect(lines.findIndex((l) => l.includes("r2 bucket list"))).toBeLessThan(
      d,
    );
  });

  it("generates only missing, distinct, 32-byte secrets", async () => {
    const f = fake({ secrets: ["SESSION_SECRET"] });
    await go(f);
    const bulk = f.st.calls.find((c) => c.line.includes("secret bulk"));
    const payload = JSON.parse(bulk.input);
    expect(Object.keys(payload).sort()).toEqual([
      "DOWNLOAD_SECRET",
      "TOKEN_KEY",
    ]);
    const a = Buffer.from(payload.DOWNLOAD_SECRET, "base64");
    const b = Buffer.from(payload.TOKEN_KEY, "base64");
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
    expect(payload.DOWNLOAD_SECRET).not.toBe(payload.TOKEN_KEY);
  });

  it("never regenerates when all generated secrets exist", async () => {
    const f = fake({
      secrets: ["SESSION_SECRET", "DOWNLOAD_SECRET", "TOKEN_KEY"],
    });
    await go(f);
    expect(f.st.calls.some((c) => c.line.includes("secret bulk"))).toBe(false);
  });

  it("uploads provided secrets only when non-empty, even if they exist", async () => {
    const f = fake({
      secrets: [
        "SESSION_SECRET",
        "DOWNLOAD_SECRET",
        "TOKEN_KEY",
        "ADMIN_EMAIL",
      ],
    });
    await go(f, {
      GOOGLE_CLIENT_ID: "gid",
      ADMIN_EMAIL: "x@y.z",
      ACCESS_AUD: "",
    });
    const payload = JSON.parse(
      f.st.calls.find((c) => c.line.includes("secret bulk")).input,
    );
    expect(payload).toEqual({ GOOGLE_CLIENT_ID: "gid", ADMIN_EMAIL: "x@y.z" });
  });

  it("sends one bulk call via stdin; args never contain values", async () => {
    const f = fake();
    await go(f, PROVIDED);
    const bulks = f.st.calls.filter((c) => c.line.includes("secret bulk"));
    expect(bulks).toHaveLength(1);
    const payload = JSON.parse(bulks[0].input);
    const values = Object.values(payload);
    expect(values.length).toBe(8);
    for (const c of f.st.calls)
      for (const v of values) expect(c.args.join(" ")).not.toContain(v);
  });

  it("deletes ALLOW_DEV_ADMIN with a warning", async () => {
    const f = fake({
      secrets: [
        "ALLOW_DEV_ADMIN",
        "SESSION_SECRET",
        "DOWNLOAD_SECRET",
        "TOKEN_KEY",
      ],
    });
    await go(f);
    expect(
      f.st.calls.some((c) => c.line.includes("secret delete ALLOW_DEV_ADMIN")),
    ).toBe(true);
    expect(logs.join("\n")).toMatch(/ALLOW_DEV_ADMIN/);
    expect(logs.join("\n").toLowerCase()).toMatch(/warn|::warning/);
  });

  it("summary and logs contain names only, no secret values", async () => {
    const f = fake();
    const code = await go(f, PROVIDED);
    expect(code).toBe(0);
    const payload = JSON.parse(
      f.st.calls.find((c) => c.line.includes("secret bulk")).input,
    );
    const all = logs.join("\n");
    for (const v of Object.values(payload)) expect(all).not.toContain(v);
    for (const n of Object.keys(payload)) expect(all).toContain(n);
  });

  it("emits ::add-mask:: for generated values before anything else in GitHub Actions", async () => {
    const f = fake();
    await go(f, { GITHUB_ACTIONS: "true" });
    const payload = JSON.parse(
      f.st.calls.find((c) => c.line.includes("secret bulk")).input,
    );
    const masks = logs.filter((l) => l.startsWith("::add-mask::"));
    expect(masks.map((m) => m.slice(12)).sort()).toEqual(
      [
        payload.SESSION_SECRET,
        payload.DOWNLOAD_SECRET,
        payload.TOKEN_KEY,
      ].sort(),
    );
    const firstMask = logs.findIndex((l) => l.startsWith("::add-mask::"));
    expect(firstMask).toBe(0);
  });

  it("missing provided secrets: exit 0 and tells which GitHub secret to add", async () => {
    const f = fake({
      secrets: ["SESSION_SECRET", "DOWNLOAD_SECRET", "TOKEN_KEY"],
    });
    const code = await go(f);
    expect(code).toBe(0);
    const all = logs.join("\n");
    expect(all).toContain("GOOGLE_CLIENT_ID");
    expect(all).toMatch(/re-?run/i);
  });

  it("fails (non-zero) without Cloudflare credentials", async () => {
    const f = fake();
    expect(await go(f, { CLOUDFLARE_API_TOKEN: "" })).not.toBe(0);
    expect(f.st.calls).toHaveLength(0);
  });

  it("fails and skips secrets when deploy fails", async () => {
    const f = fake({ failDeploy: true });
    expect(await go(f, PROVIDED)).not.toBe(0);
    expect(f.st.calls.some((c) => c.line.includes("secret "))).toBe(false);
  });

  it("fails when bulk upload fails", async () => {
    const f = fake();
    const run = async (c, a, o) =>
      a.includes("bulk")
        ? { code: 1, stdout: "", stderr: "nope" }
        : f.run(c, a, o);
    expect(await go({ run }, PROVIDED)).not.toBe(0);
  });

  it("fails when secret list fails", async () => {
    const f = fake();
    const run = async (c, a, o) =>
      a.includes("list") && a.includes("secret")
        ? { code: 1, stdout: "", stderr: "x" }
        : f.run(c, a, o);
    expect(await go({ run }, PROVIDED)).not.toBe(0);
  });

  it("reports wrangler.jsonc change through the result file output", async () => {
    const f = fake();
    const out = path.join(path.dirname(cfg), "gh-output");
    writeFileSync(out, "");
    await go(f, { GITHUB_OUTPUT: out });
    expect(readFileSync(out, "utf8")).toContain("changed=true");
  });
});
