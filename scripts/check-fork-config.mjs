// Deploy guard (see .github/workflows/deploy.yml). Node stdlib only.
// `main` ships the owner's D1 database_id in wrangler.jsonc. A fork must get its
// own id from the Setup workflow (step 8 of docs/SELF-HOSTING.md). Deploying a
// fork before that would point `wrangler d1 migrations apply` at the owner's
// database (it fails on the fork's account, but with a confusing error), so we
// stop early with a clear message. The owner's repo is never blocked.
// If the upstream repository is renamed or transferred, update OWNER_REPO.
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { maskJsonc } from "./setup-cloudflare.mjs";

export const OWNER_REPO = "PAumedes/381s-galleries";
export const OWNER_DB_ID = "5aa33a23-9b94-45dd-a3b8-11305cd8affb".toLowerCase();

/** First database_id in the (comment-stripped) wrangler config, or null. */
export function readDatabaseId(src) {
  const m = /"database_id"\s*:\s*"([^"]*)"/.exec(maskJsonc(src));
  return m ? m[1] : null;
}

/** Every database_id in the (comment-stripped) config, trimmed and lowercased. */
export function readDatabaseIds(src) {
  return [...maskJsonc(src).matchAll(/"database_id"\s*:\s*"([^"]*)"/g)].map(
    (m) => m[1].trim().toLowerCase(),
  );
}

const normRepo = (r) => (r ?? "").trim().toLowerCase();
const isFork = (r) =>
  normRepo(r) !== "" && normRepo(r) !== OWNER_REPO.toLowerCase();

export function checkForkConfig({ config, repository }) {
  const usesOwnerDb = readDatabaseIds(config).includes(OWNER_DB_ID);
  if (usesOwnerDb && isFork(repository)) {
    return {
      ok: false,
      message:
        "wrangler.jsonc still has the original project's D1 database_id, so this fork has not been set up yet. " +
        "Run the Setup workflow first (Actions > Setup > Run workflow); it writes your own database_id. " +
        "(Ejecuta primero el workflow Setup: guarda el database_id de tu propia base.)",
    };
  }
  return { ok: true, message: "" };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repository = process.env.GITHUB_REPOSITORY;
  let config;
  try {
    config = readFileSync("wrangler.jsonc", "utf8");
  } catch {
    // Owner: never block (later steps fail clearly). Fork: cannot verify, stop.
    if (isFork(repository)) {
      console.log(
        "::error::Could not read wrangler.jsonc, so the fork setup cannot be verified. " +
          "Make sure the file exists at the repository root. " +
          "(No se pudo leer wrangler.jsonc; verifica que exista en la raiz del repositorio.)",
      );
      process.exit(1);
    }
    process.exit(0);
  }
  const r = checkForkConfig({ config, repository });
  if (!r.ok) console.log(`::error::${r.message}`);
  process.exit(r.ok ? 0 : 1);
}
