import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, nowIso, schema } from "../app/db";
import { hashPin } from "../app/lib/server/crypto";
import { CLIENT_PAGE_D1_QUERIES } from "../app/lib/server/d1-limits";
import { executionContext } from "../app/lib/server/context";
import { galleryLoader } from "../app/lib/server/gallery-route";
import { loadHome } from "../app/lib/server/home";
import * as slugRoute from "../app/routes/$slug";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv } from "./support/warm";

const db = getDb(env);
const e = env as Env;
const ORIGIN = "https://gallery.381studios.ar";

const ctx = () => {
  const c = new RouterContextProvider();
  c.set(executionContext, {
    waitUntil() {},
    passThroughException() {},
  } as never);
  return c;
};
const req = (path: string) =>
  new Request(ORIGIN + path, { headers: { "Sec-Fetch-Mode": "navigate" } });

type Out = {
  status: number;
  headers: Headers;
  data: Record<string, unknown> & {
    state?: string;
    items?: {
      slug: string;
      clientSlug?: string;
      locked?: boolean;
      cover: { id: string } | null;
    }[];
  };
};
async function settle(p: Promise<unknown>): Promise<Out> {
  const r = (await p) as {
    type: string;
    data: Out["data"];
    init: ResponseInit;
  };
  return {
    status: r.init?.status ?? 200,
    headers: new Headers(r.init?.headers),
    data: r.data,
  };
}
const load = (path: string, album: string, base: Env = e) =>
  settle(
    galleryLoader(
      { request: req(path), context: ctx() } as never,
      { album },
      base,
    ),
  );

let n = 0;
async function album(
  slug: string,
  clientId: string | null,
  over: Partial<typeof schema.galleries.$inferInsert> = {},
  photo: Partial<typeof schema.photos.$inferInsert> | null = {},
) {
  const id = `g-${slug}`;
  await db.insert(schema.galleries).values({
    id,
    driveFolderId: `drive-SECRET-${slug}`,
    slug,
    title: `Title ${slug}`,
    status: "published",
    showOnHome: true,
    clientId,
    ...over,
  });
  if (photo)
    await db.insert(schema.photos).values({
      id: `p-${slug}-${++n}`,
      galleryId: id,
      baseName: `IMG_${slug}`,
      driveHighresId: `hr-SECRET-${slug}`,
      sort: 0,
      width: 3000,
      height: 2000,
      ...photo,
    });
  return id;
}

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("photos", "galleries", "clients");
  await db.insert(schema.clients).values([
    { id: "c-acme", slug: "acme", name: "ACME Corp" },
    { id: "c-off", slug: "off", name: "Off", pageEnabled: false },
    { id: "c-empty", slug: "empty", name: "Empty" },
    { id: "c-draft", slug: "draftonly", name: "Draft only" },
    { id: "c-other", slug: "other", name: "Other" },
  ]);
});

describe("T6.40e client homepage /:client", () => {
  it("lists the client's visible albums with canonical links, newest first like the home", async () => {
    await album("old", "c-acme", { eventDate: "2024-01-01" });
    await album("new", "c-acme", { eventDate: "2026-05-05" });
    await album("mid", "c-acme", { eventDate: "2025-03-03" });
    await album("elsewhere", "c-other");
    await album("noclient", null);
    const r = await load("/acme", "acme");
    expect(r.status).toBe(200);
    expect(r.data.state).toBe("client");
    expect(r.data.clientName).toBe("ACME Corp");
    expect(r.data.clientSlug).toBe("acme");
    expect(r.data.items!.map((i) => i.slug)).toEqual(["new", "mid", "old"]);
    expect(r.data.items!.every((i) => i.clientSlug === "acme")).toBe(true);
    // same order as the public home for the same albums
    const home = (await loadHome(e)).items
      .filter((i) => i.clientSlug === "acme")
      .map((i) => i.slug);
    expect(home).toEqual(r.data.items!.map((i) => i.slug));
  });

  it("matches the client slug case-insensitively and works through the /:slug route", async () => {
    await album("a1", "c-acme");
    const r = await settle(
      slugRoute.loader({
        request: req("/ACME"),
        params: { slug: "ACME" },
        context: ctx(),
      } as never) as Promise<unknown>,
    );
    expect(r.data.state).toBe("client");
    expect(r.data.clientSlug).toBe("acme");
  });

  it("lists every published album of the client, regardless of show_on_home; not draft/archived/expired/coverless", async () => {
    const past = nowIso(new Date(Date.now() - 1000));
    await album("ok", "c-acme");
    await album("draft", "c-acme", { status: "draft" });
    await album("arch", "c-acme", { status: "archived" });
    await album("hidden", "c-acme", { showOnHome: false });
    await album("expired", "c-acme", { expiresAt: past });
    await album("nophotos", "c-acme", {}, null);
    await album("missing", "c-acme", {}, { missingSince: nowIso() });
    const r = await load("/acme", "acme");
    expect(r.data.items!.map((i) => i.slug).sort()).toEqual(["hidden", "ok"]);
    // the studio home is unchanged: the hidden album is not there
    expect((await loadHome(e)).items.map((i) => i.slug)).not.toContain(
      "hidden",
    );
  });

  it("a client whose albums are all off the studio home still has a page (not-models regression)", async () => {
    await album("private", "c-acme", { showOnHome: false });
    const r = await load("/acme", "acme");
    expect(r.status).toBe(200);
    expect(r.data.items!.map((i) => i.slug)).toEqual(["private"]);
  });

  it("Prueba: the cover is a preview-wm photo; without one the album is left off", async () => {
    await album("pr", "c-acme", { mode: "proofing" }, { id: "clean" });
    await album("ok", "c-acme");
    expect(
      (await load("/acme", "acme")).data.items!.map((i) => i.slug),
    ).toEqual(["ok"]);
    await db.insert(schema.photos).values({
      id: "wm1",
      galleryId: "g-pr",
      baseName: "W",
      driveHighresId: "hr-w",
      driveWmId: "wm-file",
      sort: 5,
    });
    const items = (await load("/acme", "acme")).data.items!;
    expect(items.find((i) => i.slug === "pr")!.cover!.id).toBe("wm1");
  });

  it("PIN albums are listed without a cover, flagged locked, and leak nothing", async () => {
    const pin = await hashPin("4321");
    await album("secret", "c-acme", { pinHash: pin });
    await album("open", "c-acme");
    const r = await load("/acme", "acme");
    const item = r.data.items!.find((i) => i.slug === "secret")!;
    expect(item.locked).toBe(true);
    expect(item.cover).toBeNull();
    const open = r.data.items!.find((i) => i.slug === "open")!;
    expect(open.locked).toBeUndefined();
    expect(open.cover).not.toBeNull();
    const json = JSON.stringify(r.data);
    for (const bad of [pin, "SECRET", "drive", "hr-", "pinHash", "4321"])
      expect(json).not.toContain(bad);
  });

  it("a PIN album is listed next to a hidden-from-home one (T6.40f)", async () => {
    // Setting a PIN clears show_on_home and the admin refuses to set it again,
    // so owner decision 1 only holds if the client page ignores the flag for PIN albums.
    await album("secret", "c-acme", {
      pinHash: await hashPin("4321"),
      showOnHome: false,
    });
    await album("hidden", "c-acme", { showOnHome: false });
    const r = await load("/acme", "acme");
    expect(r.data.items!.map((i) => i.slug).sort()).toEqual([
      "hidden",
      "secret",
    ]);
    expect(r.data.items!.find((i) => i.slug === "secret")).toMatchObject({
      locked: true,
      cover: null,
    });
    // the studio home still never lists it
    expect((await loadHome(e)).items.map((i) => i.slug)).not.toContain(
      "secret",
    );
  });

  it("a client with only PIN albums still has a page", async () => {
    await album("secret", "c-acme", { pinHash: await hashPin("1") }, null);
    const r = await load("/acme", "acme");
    expect(r.data.state).toBe("client");
    expect(r.data.items!.map((i) => i.slug)).toEqual(["secret"]);
  });

  it("404 like any unknown slug: page disabled, no visible albums, unknown", async () => {
    await album("o1", "c-off");
    await album("d1", "c-draft", { status: "draft" });
    const unknown = await load("/nope", "nope");
    expect(unknown.status).toBe(404);
    expect(unknown.data).toEqual({ state: "unavailable", origin: ORIGIN });
    for (const slug of ["off", "empty", "draftonly"]) {
      const r = await load(`/${slug}`, slug);
      expect(r.status).toBe(404);
      expect(r.data).toEqual(unknown.data);
      expect(r.headers.get("X-Robots-Tag")).toBe(
        unknown.headers.get("X-Robots-Tag"),
      );
    }
  });

  it("an album slug is never shadowed by the client lookup (one namespace)", async () => {
    await album("pub", "c-acme");
    const r = await settle(
      slugRoute.loader({
        request: req("/pub"),
        params: { slug: "pub" },
        context: ctx(),
      } as never) as Promise<unknown>,
    );
    // still the T6.40d redirect to the client address
    expect(r.data).toBeUndefined();
  });

  it("uses at most 4 D1 queries (3), and no client lookup for reserved or dotted segments", async () => {
    await album("a1", "c-acme");
    await album("a2", "c-acme", { pinHash: await hashPin("1") });
    const c = countingEnv(e);
    const r = await load("/acme", "acme", c.e);
    expect(r.data.state).toBe("client");
    expect(c.count()).toBeLessThanOrEqual(4);
    expect(c.count()).toBe(CLIENT_PAGE_D1_QUERIES);
    for (const bad of ["admin", "favicon.ico", "robots.txt"]) {
      const z = countingEnv(e);
      await load(`/${bad}`, bad, z.e);
      expect(z.count()).toBeLessThanOrEqual(1);
    }
    // an unknown slug costs the album lookup plus the client lookup
    const u = countingEnv(e);
    await load("/nope", "nope", u.e);
    expect(u.count()).toBe(2);
  });

  it("sends the same security headers as the other public pages", async () => {
    await album("a1", "c-acme");
    const h = (await load("/acme", "acme")).headers;
    expect(h.get("Cache-Control")).toBe("private, no-store");
    expect(h.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Referrer-Policy")).toBe("same-origin");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
