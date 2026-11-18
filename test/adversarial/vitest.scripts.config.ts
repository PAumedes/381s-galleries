import { defineConfig } from "vitest/config";
// Node-side adversarial tests: pnpm exec vitest run -c test/adversarial/vitest.scripts.config.ts
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/adversarial/**/*.node.test.mjs"],
  },
});
