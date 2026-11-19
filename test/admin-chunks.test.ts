import { describe, expect, it } from "vitest";
import wranglerRaw from "../wrangler.jsonc?raw";
import { ADMIN_ASSET_PREFIX } from "../app/lib/server/admin-assets";
import {
  ADMIN_DIR,
  chunkFileNameFor,
  findAdminOnlyModules,
  isAdminRouteId,
} from "../vite/admin-chunks";

describe("isAdminRouteId", () => {
  it("matches admin route modules, with or without a query", () => {
    for (const id of [
      "/r/app/routes/admin.tsx",
      "/r/app/routes/admin._index.tsx?__react-router-build-client-route",
      "/r/app/routes/admin.g.$id.tsx?__react-router-build-client-route",
      "/r/app/routes/admin.img.$photoId.$variant.tsx",
      "/r/app/routes/api.admin.sync.tsx",
    ]) {
      expect(isAdminRouteId(id)).toBe(true);
    }
  });
  it("does not match public routes or look-alikes", () => {
    for (const id of [
      "/r/app/routes/home.tsx",
      "/r/app/routes/$slug.tsx",
      "/r/app/routes/api.g.$slug.bulk.tsx",
      "/r/app/routes/administer.tsx",
      "/r/app/components/admin/AdminShell.tsx",
      "/r/app/root.tsx",
    ]) {
      expect(isAdminRouteId(id)).toBe(false);
    }
  });
});

describe("findAdminOnlyModules", () => {
  const graph: Record<string, string[]> = {
    entry: ["react", "root"],
    root: ["react", "t"],
    home: ["react", "share"],
    adminRoute: ["react", "adminLib", "share", "qr"],
    adminLib: ["adminDict"],
    adminDict: [],
    qr: [],
    share: [],
    t: [],
    react: [],
    lazyAdmin: ["adminOnlyDeep"],
    adminOnlyDeep: [],
  };
  const imports = (id: string) => graph[id] ?? [];
  const all = Object.keys(graph);

  it("is everything not reachable from a public root", () => {
    const admin = findAdminOnlyModules(all, ["entry", "root", "home"], imports);
    expect([...admin].sort()).toEqual(
      [
        "adminDict",
        "adminLib",
        "adminOnlyDeep",
        "adminRoute",
        "lazyAdmin",
        "qr",
      ].sort(),
    );
    expect(admin.has("share")).toBe(false);
    expect(admin.has("react")).toBe(false);
  });

  it("a module a public page also imports stays public", () => {
    const admin = findAdminOnlyModules(
      all,
      ["entry", "root", "home", "adminLib"],
      imports,
    );
    expect(admin.has("adminLib")).toBe(false);
    expect(admin.has("adminDict")).toBe(false);
    expect(admin.has("adminRoute")).toBe(true);
  });

  it("copes with cycles", () => {
    const g: Record<string, string[]> = {
      a: ["b"],
      b: ["a"],
      c: ["d"],
      d: ["c"],
    };
    const admin = findAdminOnlyModules(
      ["a", "b", "c", "d"],
      ["a"],
      (i) => g[i],
    );
    expect([...admin].sort()).toEqual(["c", "d"]);
  });
});

describe("chunkFileNameFor", () => {
  const admin = new Set([
    "/r/app/routes/admin.tsx",
    "/r/node_modules/qrcode/lib/a.js",
  ]);
  it("puts all-admin chunks under the admin directory", () => {
    expect(
      chunkFileNameFor(
        ["/r/app/routes/admin.tsx", "/r/node_modules/qrcode/lib/a.js"],
        admin,
        "assets",
      ),
    ).toBe(`${ADMIN_DIR}/[name]-[hash].js`);
  });
  it("keeps a chunk public when any module is public", () => {
    expect(
      chunkFileNameFor(
        ["/r/app/routes/admin.tsx", "/r/app/lib/share.ts"],
        admin,
        "assets",
      ),
    ).toBe("assets/[name]-[hash].js");
  });
  it("keeps module-less chunks (runtime helpers) public", () => {
    expect(chunkFileNameFor([], admin, "assets")).toBe(
      "assets/[name]-[hash].js",
    );
    expect(chunkFileNameFor(["\0rolldown/runtime.js"], admin, "assets")).toBe(
      "assets/[name]-[hash].js",
    );
  });
  it("uses the configured assets dir for public chunks", () => {
    expect(chunkFileNameFor(["x"], admin, "static")).toBe(
      "static/[name]-[hash].js",
    );
  });
});

describe("admin asset wiring", () => {
  it("the build directory, the Worker prefix and wrangler.jsonc agree", () => {
    expect(`/${ADMIN_DIR}/`).toBe(ADMIN_ASSET_PREFIX);
    // Comments hold quotes and "/*"; look at the raw text instead of parsing.
    expect(wranglerRaw).toContain(
      `"run_worker_first": ["${ADMIN_ASSET_PREFIX}*"]`,
    );
    expect(wranglerRaw).toContain('"binding": "ASSETS"');
  });
});
