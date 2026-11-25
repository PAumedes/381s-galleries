import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import {
  clientAction,
  createClientAction,
} from "../app/lib/server/admin-clients";
import { galleryAction } from "../app/lib/server/admin-galleries";
import { executionContext } from "../app/lib/server/context";
import {
  CLIENT_PAGE_D1_QUERIES,
  SLUG_LOADER_D1_QUERIES,
} from "../app/lib/server/d1-limits";
import { hashPin } from "../app/lib/server/crypto";
import { galleryLoader } from "../app/lib/server/gallery-route";
import * as clientRoute from "../app/routes/$client.$album";
import * as slugRoute from "../app/routes/$slug";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv } from "./support/warm";

// T6.40f: the whole client-folder lifecycle through the real admin actions and
// public loaders: create -> assign (defaults copied once) -> redirect -> client
// page -> page disabled -> delete -> album back to its plain URL.
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const ORIGIN = "https://gallery.381studios.ar";
const db = getDb(env);

beforeAll(migrateDb);
beforeEach(() =>
  resetTables("gallery_views", "rate_limits", "photos", "galleries", "clients"),
);

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
const post = (path: string, body: Record<string, string>) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    body: new URLSearchParams(body),
  });

interface Out {
  status: number;
  location: string | null;
  data?: Record<string, unknown> & {
    state?: string;
    items?: { slug: string; locked?: boolean; cover: unknown }[];
  };
}
async function settle(p: Promise<unknown>): Promise<Out> {
  const r = (await p) as Response | { data: Out["data"]; init?: ResponseInit };
  if (r instanceof Response)
    return { status: r.status, location: r.headers.get("Location") };
  return { status: r.init?.status ?? 200, location: null, data: r.data };
}
const viaSlug = (slug: string) =>
  settle(
    slugRoute.loader({
      request: req("/" + slug),
      params: { slug },
      context: ctx(),
    } as never) as Promise<unknown>,
  );
const viaClient = (client: string, album: string) =>
  settle(
    clientRoute.loader({
      request: req(`/${client}/${album}`),
      params: { client, album },
      context: ctx(),
    } as never) as Promise<unknown>,
  );
/** D1 queries one loader run spends. */
async function queries(slug: string, client?: string) {
  const c = countingEnv(e);
  await galleryLoader(
    {
      request: req(client ? `/${client}/${slug}` : "/" + slug),
      context: ctx(),
    } as never,
    client ? { client, album: slug } : { album: slug },
    c.e,
  );
  return c.count();
}
async function redirectTarget(p: Promise<unknown>) {
  try {
    await p;
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  throw new Error("expected a redirect");
}
async function addAlbum(
  slug: string,
  over: Partial<typeof schema.galleries.$inferInsert> = {},
) {
  await db.insert(schema.galleries).values({
    id: `g-${slug}`,
    driveFolderId: `drive-SECRET-${slug}`,
    slug,
    title: `Title ${slug}`,
    status: "published",
    ...over,
  });
  if (!over.pinHash)
    await db.insert(schema.photos).values({
      id: `p-${slug}`,
      galleryId: `g-${slug}`,
      baseName: `IMG_${slug}`,
      driveHighresId: `hr-SECRET-${slug}`,
      sort: 0,
      width: 3000,
      height: 2000,
    });
}
const albumRow = (id: string) =>
  env.DB.prepare(
    "SELECT client_id, mode, show_on_home, slug FROM galleries WHERE id = ?1",
  )
    .bind(id)
    .first<{
      client_id: string | null;
      mode: string;
      show_on_home: number;
      slug: string;
    }>();

/** Rows anywhere that still point at a client id (any table with a client_id column). */
async function rowsReferencing(clientId: string) {
  const tables = Object.values(schema)
    .filter((t) => is(t, SQLiteTable))
    .map((t) => ({ name: getTableName(t), cols: getTableColumns(t) }))
    .filter((t) => Object.values(t.cols).some((c) => c.name === "client_id"));
  expect(tables.map((t) => t.name)).toContain("galleries");
  let n = 0;
  for (const { name } of tables)
    n += (await env.DB.prepare(
      `SELECT count(*) AS n FROM ${name} WHERE client_id = ?1`,
    )
      .bind(clientId)
      .first<{ n: number }>())!.n;
  return n;
}

/** Every table, every text cell: rows that still hold `needle` as a whole value. */
async function cellsEqualTo(needle: string) {
  const { results: tables } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'",
  ).all<{ name: string }>();
  const hits: string[] = [];
  for (const { name } of tables) {
    const { results: cols } = await env.DB.prepare(
      `SELECT name FROM pragma_table_info('${name}')`,
    ).all<{ name: string }>();
    if (!cols.length) continue;
    const where = cols
      .map((c) => `CAST("${c.name}" AS TEXT) = ?1 COLLATE NOCASE`)
      .join(" OR ");
    const n = (await env.DB.prepare(
      `SELECT count(*) AS n FROM "${name}" WHERE ${where}`,
    )
      .bind(needle)
      .first<{ n: number }>())!.n;
    if (n) hits.push(`${name}:${n}`);
  }
  return hits;
}

describe("T6.40f client folders end to end", () => {
  it("create -> assign -> redirect -> client page -> disabled -> delete -> unassigned", async () => {
    // 1. create the client and set its defaults (Prueba + show on home)
    const created = await redirectTarget(
      createClientAction(
        post("/admin/clients", { name: "ACME Corp", slug: "acme" }),
        e,
      ),
    );
    expect(created.status).toBe(303);
    const clientId = created.headers.get("Location")!.split("/").pop()!;
    const saved = await clientAction(
      post(`/admin/clients/${clientId}`, {
        intent: "save",
        name: "ACME Corp",
        slug: "acme",
        pageEnabled: "1",
        defaultMode: "proofing",
        defaultShowOnHome: "1",
      }),
      e,
      clientId,
    );
    expect(saved.ok).toBe(true);

    // an unassigned album and a PIN album, both published
    await addAlbum("boda");
    await db.insert(schema.photos).values({
      id: "wm1",
      galleryId: "g-boda",
      baseName: "W",
      driveHighresId: "hr-w",
      driveWmId: "wm",
      sort: 1,
    });
    await addAlbum("secret", { pinHash: await hashPin("4321") });
    expect(await albumRow("g-boda")).toMatchObject({
      client_id: null,
      mode: "delivery",
    });
    expect((await viaSlug("boda")).status).toBe(200);

    // 2. assign through the album details save: defaults copied once
    const details = (id: string, slug: string, clientIdValue: string) =>
      galleryAction(
        post(`/admin/g/${id}`, {
          intent: "details",
          title: `Title ${slug}`,
          slug,
          eventDate: "",
          expiresDate: "",
          expiresTime: "",
          clientId: clientIdValue,
        }),
        e,
        id,
      );
    expect((await details("g-boda", "boda", clientId)).ok).toBe(true);
    expect((await details("g-secret", "secret", clientId)).ok).toBe(true);
    expect(await albumRow("g-boda")).toMatchObject({
      client_id: clientId,
      mode: "proofing",
      show_on_home: 1,
      slug: "boda",
    });
    // defaults are a copy, not live: changing the client later leaves the album alone
    await clientAction(
      post(`/admin/clients/${clientId}`, {
        intent: "save",
        name: "ACME Corp",
        slug: "acme",
        pageEnabled: "1",
        defaultMode: "delivery",
      }),
      e,
      clientId,
    );
    expect(await albumRow("g-boda")).toMatchObject({
      mode: "proofing",
      show_on_home: 1,
    });

    // 3. /:slug 302s to the canonical address; the canonical one is served
    const redirect = await viaSlug("boda");
    expect(redirect.status).toBe(302);
    expect(redirect.location).toBe("/acme/boda");
    expect((await viaClient("acme", "boda")).status).toBe(200);
    expect(await queries("boda", "acme")).toBeLessThanOrEqual(
      SLUG_LOADER_D1_QUERIES,
    );
    expect(await queries("boda")).toBeLessThanOrEqual(SLUG_LOADER_D1_QUERIES);

    // 4. the client page lists both; the PIN album is locked and has no cover
    const page = await viaSlug("acme");
    expect(page.status).toBe(200);
    expect(page.data).toMatchObject({
      state: "client",
      clientName: "ACME Corp",
    });
    const items = page.data!.items!;
    expect(items.map((i) => i.slug).sort()).toEqual(["boda", "secret"]);
    expect(items.find((i) => i.slug === "secret")).toMatchObject({
      locked: true,
      cover: null,
    });
    expect(items.find((i) => i.slug === "boda")!.cover).not.toBeNull();
    expect(JSON.stringify(page.data)).not.toMatch(/SECRET|hr-|pinHash/);
    expect(await queries("acme")).toBeLessThanOrEqual(CLIENT_PAGE_D1_QUERIES);

    // 5. page_enabled = 0 is the same 404 as an unknown slug
    await clientAction(
      post(`/admin/clients/${clientId}`, {
        intent: "save",
        name: "ACME Corp",
        slug: "acme",
        defaultMode: "delivery",
      }),
      e,
      clientId,
    );
    const off = await viaSlug("acme");
    const unknown = await viaSlug("nobody");
    expect(off.status).toBe(404);
    expect(off).toEqual(unknown);
    // the albums keep working under the client address
    expect((await viaClient("acme", "boda")).status).toBe(200);

    // 6. delete the client (typed slug): albums survive, unassigned
    const wrong = await clientAction(
      post(`/admin/clients/${clientId}`, { intent: "delete", slug: "nope" }),
      e,
      clientId,
    );
    expect(wrong.ok).toBe(false);
    expect(await rowsReferencing(clientId)).toBe(2);
    const del = await redirectTarget(
      clientAction(
        post(`/admin/clients/${clientId}`, { intent: "delete", slug: "acme" }),
        e,
        clientId,
      ),
    );
    expect(del.status).toBe(303);
    expect(del.headers.get("Location")).toBe("/admin/clients?deleted=1");

    expect(await albumRow("g-boda")).toMatchObject({
      client_id: null,
      slug: "boda",
    });
    expect(await albumRow("g-secret")).toMatchObject({ client_id: null });
    expect(
      (await env.DB.prepare(
        "SELECT count(*) AS n FROM photos WHERE gallery_id = 'g-boda'",
      ).first<{ n: number }>())!.n,
    ).toBe(2);
    // no orphan rows: the client is gone and nothing points at it
    expect(
      (await env.DB.prepare("SELECT count(*) AS n FROM clients").first<{
        n: number;
      }>())!.n,
    ).toBe(0);
    expect(await rowsReferencing(clientId)).toBe(0);
    // no row in ANY table (settings, activity, ...) keeps the client id or slug
    expect(await cellsEqualTo(clientId)).toEqual([]);
    expect(await cellsEqualTo("acme")).toEqual([]);
    expect(
      (await env.DB.prepare(
        "SELECT count(*) AS n FROM galleries WHERE client_id IS NOT NULL AND client_id NOT IN (SELECT id FROM clients)",
      ).first<{ n: number }>())!.n,
    ).toBe(0);

    // /:slug serves the album again, no redirect; the client address is gone
    const back = await viaSlug("boda");
    expect(back.status).toBe(200);
    expect(back.location).toBeNull();
    // the old client address no longer serves the album: it falls back to the
    // plain URL (T6.40d: an available album under an unknown client redirects)
    const old = await viaClient("acme", "boda");
    expect(old.status).toBe(302);
    expect(old.location).toBe("/boda");
    expect((await viaClient("acme", "secret")).location).toBe("/secret");
    expect((await viaSlug("acme")).status).toBe(404);

    // 7. the client slug is reusable (also as a new client's slug)
    const again = await redirectTarget(
      createClientAction(
        post("/admin/clients", { name: "ACME again", slug: "acme" }),
        e,
      ),
    );
    expect(again.status).toBe(303);
    expect((await viaSlug("boda")).status).toBe(200);
  });

  it("T6.50 client page -> album carries the back link; a direct open does not", async () => {
    const created = await redirectTarget(
      createClientAction(
        post("/admin/clients", { name: "ACME Corp", slug: "acme" }),
        e,
      ),
    );
    const clientId = created.headers.get("Location")!.split("/").pop()!;
    await addAlbum("boda");
    await env.DB.prepare(
      "UPDATE galleries SET client_id = ?1 WHERE id = 'g-boda'",
    )
      .bind(clientId)
      .run();
    const open = (path: string, referer?: string) =>
      settle(
        clientRoute.loader({
          request: new Request(ORIGIN + path, {
            headers: {
              "Sec-Fetch-Mode": "navigate",
              ...(referer ? { Referer: referer } : {}),
            },
          }),
          params: { client: "acme", album: "boda" },
          context: ctx(),
        } as never) as Promise<unknown>,
      );

    // the client page lists the album; its tile href is where the visitor clicks
    const page = await viaSlug("acme");
    const tile = page
      .data!.items!.map((i) => i as { slug: string; clientSlug?: string })
      .find((i) => i.slug === "boda")!;
    expect(tile.clientSlug).toBe("acme");

    const from = await open("/acme/boda", `${ORIGIN}/acme?pagina=2`);
    expect(from.data!.backToClient).toEqual({
      name: "ACME Corp",
      href: "/acme?pagina=2",
    });
    const direct = await open("/acme/boda");
    expect(direct.data!.state).toBe("open");
    expect(JSON.stringify(direct.data)).not.toContain("ACME Corp");
    expect(direct.data).not.toHaveProperty("backToClient");
    // the client page switched off: the link is gone with the page
    await env.DB.prepare("UPDATE clients SET page_enabled = 0 WHERE id = ?1")
      .bind(clientId)
      .run();
    expect(
      (await open("/acme/boda", `${ORIGIN}/acme`)).data,
    ).not.toHaveProperty("backToClient");
  });
});
