import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_STUDIO_NAME } from "../app/lib/default-studio-name";
import { nonceContext } from "../app/lib/server/context";
import { handleGenericManifest } from "../app/lib/server/manifest";
import wranglerRaw from "../wrangler.jsonc?raw";
import routesSrc from "../app/routes.ts?raw";
import { loader as rootLoader, meta as rootMeta } from "../app/root";
import { meta as slugMeta } from "../app/routes/$slug";

const mutable = env as unknown as { STUDIO_NAME?: string };
const original = mutable.STUDIO_NAME;
afterEach(() => {
  mutable.STUDIO_NAME = original;
});

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});

const BAD = [
  ["unset", undefined],
  ["empty", ""],
  ["whitespace", "   "],
  ["control characters", "Lu\u0000z"],
  ["over-long", "x".repeat(61)],
] as const;

async function rootData() {
  const context = new RouterContextProvider();
  context.set(nonceContext, "n");
  const res = (await rootLoader({
    request: new Request("https://g.example/"),
    context,
    params: {},
  } as never)) as unknown as { data: { studioName: string } };
  return res.data;
}

describe("T6.20 neutral studio-name default through the real code paths", () => {
  it("is neutral", () => {
    expect(DEFAULT_STUDIO_NAME).toBe("Galleries");
  });

  it("the owner's configured name passes unchanged", async () => {
    mutable.STUDIO_NAME = "381 Studios";
    expect((await rootData()).studioName).toBe("381 Studios");
    const m = await (
      await handleGenericManifest(new Request("https://g.example/m"), env)
    ).json<{ name: string }>();
    expect(m.name).toBe("381 Studios");
  });

  describe.each(BAD)("STUDIO_NAME %s", (_n, value) => {
    it("root loader falls back to the default", async () => {
      mutable.STUDIO_NAME = value;
      const d = await rootData();
      expect(d.studioName).toBe(DEFAULT_STUDIO_NAME);
      const tags = JSON.stringify(rootMeta({ loaderData: d } as never));
      expect(tags).toContain(DEFAULT_STUDIO_NAME);
      expect(tags).not.toMatch(/381/);
    });

    it("the generic manifest response uses the default name", async () => {
      mutable.STUDIO_NAME = value;
      const res = await handleGenericManifest(
        new Request("https://g.example/manifest.webmanifest"),
        env,
      );
      expect(res.headers.get("Content-Type")).toMatch(
        /^application\/manifest\+json/,
      );
      const m = await res.json<{ name: string; short_name: string }>();
      expect(m.name).toBe(DEFAULT_STUDIO_NAME);
      expect(m.short_name).toBe(DEFAULT_STUDIO_NAME);
    });
  });

  it("generic manifest keeps the cache and security headers", async () => {
    const res = await handleGenericManifest(
      new Request("https://g.example/manifest.webmanifest"),
      env,
    );
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("root meta without loader data uses the default", () => {
    const tags = JSON.stringify(rootMeta({ loaderData: undefined } as never));
    expect(tags).toContain(DEFAULT_STUDIO_NAME);
    expect(tags).not.toMatch(/381/);
  });

  it("$slug meta without root data uses the default (og + pwa tags)", () => {
    const tags = JSON.stringify(
      slugMeta({ loaderData: undefined, matches: [] } as never),
    );
    expect(tags).toContain(DEFAULT_STUDIO_NAME);
    expect(tags).not.toMatch(/381/);
  });

  it("the generic manifest is served by the Worker, not the static file", () => {
    expect(wranglerRaw).toMatch(
      /"run_worker_first":\s*\[[^\]]*"\/manifest\.webmanifest"/,
    );
    expect(routesSrc).toContain('route("manifest.webmanifest"');
  });
});
