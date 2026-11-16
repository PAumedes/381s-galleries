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
  /** Local dev only ("1" enables the header-less admin bypass in mock mode). */
  ALLOW_DEV_ADMIN?: string;
}
declare namespace Cloudflare {
  interface Env extends __SecretEnv {
    /** `wrangler types --strict-vars=false` widens this to string; narrow it. */
    DRIVE_MODE: "google" | "mock";
  }
}
interface Env extends __SecretEnv {
  DRIVE_MODE: "google" | "mock";
}
