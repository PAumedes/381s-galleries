// One-shot, idempotent Cloudflare setup, meant to run from GitHub Actions
// (see .github/workflows/setup.yml). Node stdlib only. Never logs secret values.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DB_NAME = "381s-galleries";
export const BUCKET = "381s-galleries-cache";
export const GENERATED = ["SESSION_SECRET", "DOWNLOAD_SECRET", "TOKEN_KEY"];
export const PROVIDED = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ADMIN_EMAIL",
  "ACCESS_TEAM_DOMAIN",
  "ACCESS_AUD",
];

/** Real command runner. Output is captured (never echoed) unless `inherit`. */
export function defaultRun(cmd, args, { input, inherit } = {}) {
  const r = spawnSync(cmd, args, {
    input,
    encoding: "utf8",
    stdio: inherit
      ? ["ignore", "inherit", "inherit"]
      : ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

const wrangler = (...args) => ["pnpm", ["exec", "wrangler", ...args]];

async function wr(run, args, opts) {
  const [cmd, a] = wrangler(...args);
  return run(cmd, a, opts);
}

/** Find JSON of the expected shape in noisy wrangler stdout (banners, warnings). */
export function parseJsonArray(text) {
  const tryParse = (t) => {
    try {
      const v = JSON.parse(t);
      return Array.isArray(v) ? v : undefined;
    } catch {
      return undefined;
    }
  };
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*[[{]/.test(lines[i])) continue;
    const v = tryParse(lines.slice(i).join("\n"));
    if (v) return v;
  }
  for (let i = text.indexOf("["); i >= 0; i = text.indexOf("[", i + 1)) {
    const v = tryParse(text.slice(i));
    if (v) return v;
  }
  throw new Error("no JSON array in wrangler output");
}

export function parseBucketNames(text) {
  return [...text.matchAll(/^name:\s+(\S+)\s*$/gm)].map((m) => m[1]);
}

async function listD1(run) {
  const r = await wr(run, ["d1", "list", "--json"]);
  if (r.code !== 0) throw new Error(`wrangler d1 list failed: ${r.stderr}`);
  return parseJsonArray(r.stdout);
}

/** Blank out comments (same length; strings kept) so regexes ignore them. */
export function maskJsonc(src) {
  let out = "";
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? src.length : e + 2;
      out += src.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Set database_id of the d1 entry named DB_NAME (else the first d1 entry). null if not found. */
export function rewriteDatabaseId(src, id) {
  const masked = maskJsonc(src);
  const nameRe = new RegExp(`"database_name"\\s*:\\s*"${DB_NAME}"`, "g");
  for (const nm of masked.matchAll(nameRe)) {
    let s = nm.index;
    let depth = 0;
    for (; s >= 0; s--) {
      if (masked[s] === "}") depth++;
      else if (masked[s] === "{") {
        if (depth === 0) break;
        depth--;
      }
    }
    let e = nm.index;
    depth = 0;
    for (; e < masked.length; e++) {
      if (masked[e] === "{") depth++;
      else if (masked[e] === "}") {
        if (depth === 0) break;
        depth--;
      }
    }
    const m = /("database_id"\s*:\s*")([^"]*)"/.exec(masked.slice(s, e));
    if (!m) continue;
    const valStart = s + m.index + m[1].length;
    return src.slice(0, valStart) + id + src.slice(valStart + m[2].length);
  }
  // Fallback: first database_id inside the d1_databases array (comments ignored).
  const d = masked.indexOf('"d1_databases"');
  if (d >= 0) {
    const m = /("database_id"\s*:\s*")([^"]*)"/.exec(masked.slice(d));
    if (m) {
      const valStart = d + m.index + m[1].length;
      return src.slice(0, valStart) + id + src.slice(valStart + m[2].length);
    }
  }
  return null;
}

export async function ensureD1({ run, log, configPath = "wrangler.jsonc" }) {
  let db = (await listD1(run)).find((d) => d.name === DB_NAME);
  if (!db) {
    log(`D1 ${DB_NAME}: creating`);
    const c = await wr(run, ["d1", "create", DB_NAME]);
    if (c.code !== 0) throw new Error(`wrangler d1 create failed: ${c.stderr}`);
    db = (await listD1(run)).find((d) => d.name === DB_NAME);
    if (!db) throw new Error(`D1 ${DB_NAME} not found after create`);
  }
  const id = db.uuid ?? db.id;
  const src = readFileSync(configPath, "utf8");
  const next = rewriteDatabaseId(src, id);
  if (next === null)
    throw new Error(`d1 entry ${DB_NAME} not found in ${configPath}`);
  if (next === src) {
    log(`D1 ${DB_NAME}: ok (id already set)`);
    return { id, changed: false };
  }
  writeFileSync(configPath, next);
  log(`D1 ${DB_NAME}: database_id updated in ${configPath}`);
  return { id, changed: true };
}

export async function ensureR2({ run, log }) {
  const l = await wr(run, ["r2", "bucket", "list"]);
  if (l.code !== 0)
    throw new Error(`wrangler r2 bucket list failed: ${l.stderr}`);
  if (parseBucketNames(l.stdout).includes(BUCKET)) {
    log(`R2 ${BUCKET}: ok`);
    return "present";
  }
  const c = await wr(run, ["r2", "bucket", "create", BUCKET]);
  if (c.code !== 0) {
    if (/already exists|10004/i.test(`${c.stdout}\n${c.stderr}`)) {
      log(`R2 ${BUCKET}: already exists`);
      return "present";
    }
    throw new Error(`wrangler r2 bucket create failed: ${c.stderr}`);
  }
  log(`R2 ${BUCKET}: created`);
  return "created";
}

function table(rows) {
  const w = Math.max(...rows.map(([n]) => n.length));
  return rows.map(([n, s]) => `  ${n.padEnd(w)}  ${s}`).join("\n");
}

/** Returns the process exit code. */
export async function main({
  run = defaultRun,
  env = process.env,
  log = (m) => console.log(m),
  configPath = "wrangler.jsonc",
} = {}) {
  const inCI = env.GITHUB_ACTIONS === "true";
  // Generate first and mask before anything can possibly print them.
  const generated = Object.fromEntries(
    GENERATED.map((n) => [n, randomBytes(32).toString("base64")]),
  );
  if (inCI) for (const v of Object.values(generated)) log(`::add-mask::${v}`);

  try {
    if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
      log(
        "::error::Missing GitHub secrets CLOUDFLARE_API_TOKEN and/or CLOUDFLARE_ACCOUNT_ID (see DEPLOY.md, step 3).",
      );
      return 1;
    }

    const d1 = await ensureD1({ run, log, configPath });
    await ensureR2({ run, log });
    if (env.GITHUB_OUTPUT)
      appendFileSync(env.GITHUB_OUTPUT, `changed=${d1.changed}\n`);

    log("Deploying (migrations + build + deploy)...");
    const dr = await run("pnpm", ["run", "deploy"], { inherit: true });
    if (dr.code !== 0) throw new Error("pnpm run deploy failed");

    // Secrets only after the Worker exists.
    const sl = await wr(run, ["secret", "list", "--format", "json"]);
    if (sl.code !== 0)
      throw new Error(`wrangler secret list failed: ${sl.stderr}`);
    const existing = new Set(parseJsonArray(sl.stdout).map((s) => s.name));

    const payload = {};
    const status = [];
    for (const n of GENERATED) {
      if (existing.has(n)) status.push([n, "present (kept)"]);
      else {
        payload[n] = generated[n];
        status.push([n, "created"]);
      }
    }
    const missing = [];
    for (const n of PROVIDED) {
      const v = env[n];
      if (v) {
        payload[n] = v;
        status.push([n, "uploaded"]);
      } else if (existing.has(n)) status.push([n, "present (kept)"]);
      else {
        status.push([n, "MISSING"]);
        missing.push(n);
      }
    }

    if (Object.keys(payload).length > 0) {
      const b = await wr(run, ["secret", "bulk"], {
        input: JSON.stringify(payload),
      });
      if (b.code !== 0)
        throw new Error(`wrangler secret bulk failed: ${b.stderr}`);
    }

    if (existing.has("ALLOW_DEV_ADMIN")) {
      log(
        "::warning::ALLOW_DEV_ADMIN existed in production; deleting it (it disables admin login).",
      );
      const x = await wr(run, ["secret", "delete", "ALLOW_DEV_ADMIN"], {
        input: "y\n",
      });
      if (x.code !== 0)
        throw new Error(`could not delete ALLOW_DEV_ADMIN: ${x.stderr}`);
      status.push(["ALLOW_DEV_ADMIN", "deleted"]);
    }

    log("\nSecrets summary (names only):");
    log(table(status));
    for (const n of missing)
      log(
        `Missing ${n}: add it as a GitHub Actions secret (Settings > Secrets and variables > Actions), then re-run the Setup workflow.`,
      );
    log("\nSetup finished.");
    return 0;
  } catch (e) {
    log(`::error::${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
