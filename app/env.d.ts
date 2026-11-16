// Secrets are not in wrangler.jsonc (they come from `wrangler secret put` or
// `.dev.vars`), so `wrangler types` does not always know them. Declare them
// here; identical redeclarations by `wrangler types` merge without conflict.
interface __SecretEnv {
  SESSION_SECRET: string;
  DOWNLOAD_SECRET: string;
  /** Base64 32-byte key: `openssl rand -base64 32`. */
  TOKEN_KEY: string;
  ADMIN_EMAIL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}
declare namespace Cloudflare {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Env extends __SecretEnv {}
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Env extends __SecretEnv {}
