// Lists the Worker's secret NAMES (never values) and checks them against the
// PLAN §11 table. Exits 1 if a required one is missing or ALLOW_DEV_ADMIN exists.
import { execFileSync } from "node:child_process";

const REQUIRED = [
  "SESSION_SECRET",
  "DOWNLOAD_SECRET",
  "TOKEN_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ADMIN_EMAIL",
  "ACCESS_TEAM_DOMAIN",
  "ACCESS_AUD",
];

let out;
try {
  out = execFileSync(
    "npx",
    ["wrangler", "secret", "list", "--format", "json"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      shell: process.platform === "win32",
    },
  );
} catch {
  console.error(
    "No se pudo ejecutar `wrangler secret list` (¿hiciste `npx wrangler login` y desplegaste una vez?).",
  );
  process.exit(2);
}

const start = out.indexOf("[");
const names = new Set(JSON.parse(out.slice(start)).map((s) => s.name));

let failed = false;
for (const name of REQUIRED) {
  const ok = names.has(name);
  console.log(`${ok ? "OK     " : "FALTA  "} ${name}`);
  if (!ok) failed = true;
}
if (names.has("ALLOW_DEV_ADMIN")) {
  console.log(
    "PELIGRO ALLOW_DEV_ADMIN existe: borralo con `npx wrangler secret delete ALLOW_DEV_ADMIN`",
  );
  failed = true;
}
console.log(failed ? "\nHay problemas." : "\nTodo en orden.");
process.exit(failed ? 1 : 0);
