import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SESSION_SECRET: "test-session-secret-0123456789-abcdefghij",
            DOWNLOAD_SECRET: "test-download-secret-0123456789-abcdefghij",
            // 32 zero bytes, base64
            TOKEN_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            ADMIN_EMAIL: "Admin@Example.com",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts", "app/**/*.test.ts"],
    },
  };
});
