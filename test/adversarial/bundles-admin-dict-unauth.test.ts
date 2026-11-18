import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";
import { loader as rootLoader } from "../../app/root";
import { nonceContext } from "../../app/lib/server/context";

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});

// The dictionary split keeps admin strings out of the public JS, but the root
// loader decides by URL path only. An unauthenticated request (no Access
// headers/cookie; /admin.data is outside the Access paths per DEPLOY.md) still
// gets every admin string.
describe("root loader ships admin dictionary to unauthenticated callers", () => {
  for (const url of [
    "https://gallery.381studios.ar/admin.data?_routes=root",
    "https://gallery.381studios.ar/admin",
    "https://gallery.381studios.ar/admin/setup.data?_routes=root",
  ]) {
    it(url, async () => {
      const c = new RouterContextProvider();
      c.set(nonceContext, "n");
      const r = (await rootLoader({
        request: new Request(url),
        context: c,
      } as never)) as { data?: unknown };
      const p = (r.data ?? r) as { messages: Record<string, string> };
      expect(
        Object.keys(p.messages).filter((k) => k.startsWith("admin.")),
      ).toEqual([]);
    });
  }
});
