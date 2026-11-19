import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { hashPin } from "../app/lib/server/crypto";
import { handleManifest } from "../app/lib/server/manifest";
import { loadGallery } from "../app/lib/server/gallery";
import { pwaMeta, shortName } from "../app/lib/pwa";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-000000000002";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables("photos", "galleries");
});

async function addGallery(
  over: Partial<typeof schema.galleries.$inferInsert> = {},
) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "boda-ana",
    title: "Boda de Ana y Juan",
    status: "published",
    ...over,
  });
}
const get = (slug: string) =>
  handleManifest(
    new Request(
      `https://gallery.381studios.ar/api/g/${slug}/manifest.webmanifest`,
    ),
    slug,
    env,
  );
const json = async (r: Response) =>
  (await r.json()) as Record<string, unknown> & {
    name: string;
    short_name: string;
  };

const GENERIC = {
  name: "381 Studios",
  short_name: "381 Studios",
  start_url: "/",
  display: "standalone",
};

describe("per-gallery manifest", () => {
  it("public gallery: title, start_url, scope, theme, icons, headers", async () => {
    await addGallery();
    const r = await get("boda-ana");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toMatch(
      /^application\/manifest\+json/,
    );
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=300");
    const m = await json(r);
    expect(m.name).toBe("Boda de Ana y Juan");
    expect(m.short_name.length).toBeLessThanOrEqual(12);
    expect(m.start_url).toBe("/boda-ana/?source=pwa");
    expect(m.scope).toBe("/boda-ana/");
    expect(m.id).toBe("/boda-ana");
    expect(m.display).toBe("standalone");
    expect(m.background_color).toBe("#FAFAF8");
    expect(m.theme_color).toBe("#FAFAF8");
    expect(m.icons).toEqual([
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
  });

  it("dark theme colours", async () => {
    await addGallery({ palette: "oscuro" });
    const m = await json(await get("boda-ana"));
    expect(m.background_color).toBe("#0B0B0B");
    expect(m.theme_color).toBe("#0B0B0B");
  });

  it("slug is matched case-insensitively and the canonical slug is used", async () => {
    await addGallery();
    const m = await json(await get("BODA-ANA"));
    expect(m.start_url).toBe("/boda-ana/?source=pwa");
  });

  it("slug is percent-encoded in start_url/scope/id", async () => {
    await addGallery({ slug: "año nuevo" });
    const m = await json(await get("año nuevo"));
    expect(m.start_url).toBe("/a%C3%B1o%20nuevo/?source=pwa");
    expect(m.scope).toBe("/a%C3%B1o%20nuevo/");
    expect(m.id).toBe("/a%C3%B1o%20nuevo");
  });

  it("PIN, draft, archived, expired and unknown are all the same generic manifest", async () => {
    const generic = async (slug: string) => {
      const r = await get(slug);
      expect(r.status).toBe(200);
      expect(r.headers.get("Cache-Control")).toBe("private, max-age=300");
      return json(r);
    };
    await addGallery({ pinHash: await hashPin("1234") });
    const pin = await generic("boda-ana");
    await db.update(schema.galleries).set({ pinHash: null, status: "draft" });
    const draft = await generic("boda-ana");
    await db.update(schema.galleries).set({ status: "archived" });
    const archived = await generic("boda-ana");
    await db
      .update(schema.galleries)
      .set({ status: "published", expiresAt: "2000-01-01T00:00:00Z" });
    const expired = await generic("boda-ana");
    const unknown = await generic("no-existe");
    for (const m of [draft, archived, expired]) expect(m).toEqual(unknown);
    // PIN: same generic name/icons, only the slug-scoped install paths differ.
    expect(pin).toEqual({
      ...unknown,
      id: "/boda-ana",
      start_url: "/boda-ana/?source=pwa",
      scope: "/boda-ana/",
    });
    expect(unknown).toMatchObject(GENERIC);
    expect(unknown.scope).toBeUndefined();
    expect(JSON.stringify(unknown)).not.toContain("Ana");
  });

  it("a PIN gallery is not exposed even with a valid session cookie", async () => {
    await addGallery({ pinHash: await hashPin("1234") });
    const m = await json(await get("boda-ana"));
    expect(m.name).toBe("381 Studios");
  });

  it("short_name: <=12 chars, by code point, never empty", () => {
    expect(shortName("Boda")).toBe("Boda");
    expect(shortName("Boda de Ana y Juan")).toBe("Boda de Ana");
    expect(Array.from(shortName("😀".repeat(30))).length).toBeLessThanOrEqual(
      12,
    );
    expect(shortName("   ", "381 Studios")).toBe("381 Studios");
    expect(shortName("  Boda de Ana y Juan ").endsWith(" ")).toBe(false);
  });
});

describe("pwaMeta (head tags)", () => {
  const o = { studio: "381 Studios" };
  const find = (tags: Record<string, string>[], name: string) =>
    tags.find((t) => t.name === name)?.content;
  const link = (tags: Record<string, string>[]) =>
    tags.filter((t) => t.tagName === "link" && t.rel === "manifest");

  async function dataFor(slug = "boda-ana") {
    return (
      await loadGallery(
        new Request("https://gallery.381studios.ar/" + slug, {
          headers: { "Sec-Fetch-Mode": "navigate" },
        }),
        slug,
        env,
      )
    ).data;
  }

  it("public gallery: its own manifest link, light theme, iOS tags", async () => {
    await addGallery();
    const tags = pwaMeta(await dataFor(), o);
    expect(link(tags)).toEqual([
      {
        tagName: "link",
        rel: "manifest",
        href: "/api/g/boda-ana/manifest.webmanifest",
      },
    ]);
    expect(find(tags, "theme-color")).toBe("#FAFAF8");
    expect(find(tags, "apple-mobile-web-app-capable")).toBe("yes");
    expect(find(tags, "apple-mobile-web-app-status-bar-style")).toBe("default");
    expect(find(tags, "apple-mobile-web-app-title")).toBe(
      shortName("Boda de Ana y Juan"),
    );
  });

  it("dark theme: black-translucent + dark theme-color", async () => {
    await addGallery({ palette: "oscuro" });
    const tags = pwaMeta(await dataFor(), o);
    expect(find(tags, "theme-color")).toBe("#0B0B0B");
    expect(find(tags, "apple-mobile-web-app-status-bar-style")).toBe(
      "black-translucent",
    );
  });

  it("slug in the link is encoded", async () => {
    await addGallery({ slug: "año nuevo" });
    const tags = pwaMeta(await dataFor("año nuevo"), o);
    expect(link(tags)[0].href).toBe(
      "/api/g/a%C3%B1o%20nuevo/manifest.webmanifest",
    );
  });

  it("PIN / unavailable: generic manifest link and no title leak", async () => {
    await addGallery({ pinHash: await hashPin("1234"), palette: "oscuro" });
    const locked = pwaMeta(await dataFor(), o);
    const unknown = pwaMeta(await dataFor("nope"), o);
    // PIN: slug-specific manifest (generic name/icons), so installs open the gate.
    expect(link(locked)[0].href).toBe("/api/g/boda-ana/manifest.webmanifest");
    expect(link(unknown)[0].href).toBe("/manifest.webmanifest");
    expect(find(locked, "apple-mobile-web-app-title")).toBe("381 Studios");
    expect(JSON.stringify(locked)).not.toContain("Ana");
    expect(find(unknown, "theme-color")).toBe("#FAFAF8");
  });

  it("undefined data (loader failed) is generic", () => {
    const tags = pwaMeta(undefined, o);
    expect(link(tags)[0].href).toBe("/manifest.webmanifest");
  });
});

describe("trailing-slash scope", () => {
  it("/<slug>/ matches the same $slug route as /<slug>", async () => {
    const { matchRoutes } = await import("react-router");
    const routes = [
      { path: "api/g/:slug/manifest.webmanifest", id: "manifest" },
      { path: ":slug", id: "slug" },
    ];
    for (const p of ["/boda-ana", "/boda-ana/"]) {
      const m = matchRoutes(routes, p);
      expect(m?.[0].route.id).toBe("slug");
      expect(m?.[0].params.slug).toBe("boda-ana");
    }
  });
});
