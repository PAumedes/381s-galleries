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
    test: {
      projects: [
        {
          // Server code: runs inside the Workers runtime.
          plugins: [
            cloudflareTest({
              // Hermetic: miniflare bindings below set every var/secret the app
              // reads, so a developer's .dev.vars can't leak into tests.
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  SESSION_SECRET: "test-session-secret-0123456789-abcdefghij",
                  DOWNLOAD_SECRET: "test-download-secret-0123456789-abcdefghij",
                  // fixed random 32 bytes, base64
                  TOKEN_KEY: "yogTK+cwJid8noG4Vt0xD2UnRFi5DXpIYNqlDl+l0HE=",
                  ADMIN_EMAIL: "Admin@Example.com",
                  STUDIO_NAME: "381 Studios",
                  ALLOW_DEV_ADMIN: "",
                  DRIVE_MODE: "mock",
                  ACCESS_TEAM_DOMAIN: "",
                  ACCESS_AUD: "",
                  GOOGLE_CLIENT_ID: "",
                  GOOGLE_CLIENT_SECRET: "",
                },
              },
            }),
          ],
          test: {
            name: "workers",
            include: ["test/**/*.test.ts", "app/**/*.test.ts"],
          },
        },
        {
          // Client components: DOM tests.
          oxc: { jsx: { runtime: "automatic" } },
          test: {
            name: "dom",
            environment: "happy-dom",
            include: ["test/dom/**/*.test.tsx"],
            setupFiles: ["test/dom/setup.ts"],
          },
        },
      ],
    },
  };
});
