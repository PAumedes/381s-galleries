import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { buildInfoDefine } from "./vite/build-info.ts";
import { adminChunks } from "./vite/admin-chunks.ts";

export default defineConfig({
  define: buildInfoDefine(),
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    adminChunks(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
