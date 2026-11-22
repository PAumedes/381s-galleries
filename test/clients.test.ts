import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateDb, resetTables } from "./support/d1";
import {
  ClientError,
  assignAlbum,
  createClient,
  deleteClient,
  getClient,
  listClients,
  unassignAlbum,
  uniqueClientSlug,
  updateClient,
} from "../app/lib/server/clients";
import { slugTaken } from "../app/lib/server/admin-galleries/actions/details";
import { RESERVED_SLUGS } from "../app/lib/server/slug";
import { D1_BATCH_MAX, D1_MAX_BOUND_PARAMS } from "../app/lib/server/d1-limits";
import {
  GALLERY_TABLES,
  EXEMPT_TABLES,
} from "../app/lib/server/gallery-delete";
import routes from "../app/routes";

const e = env as Env;
beforeAll(migrateDb);
beforeEach(() => resetTables("galleries", "clients"));

const run = (s: string, ...b: unknown[]) =>
  env.DB.prepare(s)
    .bind(...b)
    .run();
const addGallery = (id: string, slug: string, clientId: string | null = null) =>
  run(
    "INSERT INTO galleries (id, drive_folder_id, slug, title, client_id) VALUES (?1, ?2, ?3, 'T', ?4)",
    id,
    `f-${id}`,
    slug,
    clientId,
  );
const clientIdOf = async (g: string) =>
  (
    await env.DB.prepare("SELECT client_id FROM galleries WHERE id = ?1")
      .bind(g)
      .first<{
        client_id: string | null;
      }>()
  )?.client_id;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ClientError);
    return (err as ClientError).code;
  }
  return null;
};

describe("T6.40a clients lib", () => {
  it("creates a client with defaults and reads it back", async () => {
    const c = await createClient(e, { name: "Coca Cola" });
    expect(c).toMatchObject({
      slug: "coca-cola",
      name: "Coca Cola",
      defaultMode: "proofing",
      defaultShowOnHome: false,
      pageEnabled: true,
    });
    expect(await getClient(e, c.id)).toEqual(c);
    expect(await getClient(e, "nope")).toBeNull();
  });

  it("create validates slug: reserved, malformed, too long, empty name", async () => {
    for (const slug of RESERVED_SLUGS)
      expect(await code(createClient(e, { name: "N", slug }))).toBe(
        "invalidSlug",
      );
    for (const slug of ["a b", "-a", "a--b", "x".repeat(61), "ñ", ""])
      expect(await code(createClient(e, { name: "N", slug }))).toBe(
        "invalidSlug",
      );
    expect(await code(createClient(e, { name: "  " }))).toBe("invalidName");
    expect(await code(createClient(e, { name: "n".repeat(121) }))).toBe(
      "invalidName",
    );
  });

  it("an explicit slug is normalised to lower case", async () => {
    expect(
      (await createClient(e, { name: "N", slug: "Mi-Cliente" })).slug,
    ).toBe("mi-cliente");
  });

  it("slug collision with a client (case-insensitive) is slugTaken", async () => {
    await createClient(e, { name: "A", slug: "acme" });
    expect(await code(createClient(e, { name: "B", slug: "ACME" }))).toBe(
      "slugTaken",
    );
  });

  it("slug collision with a gallery (case-insensitive) is slugTaken, create and update", async () => {
    await addGallery("g1", "Boda-Ana");
    expect(await code(createClient(e, { name: "B", slug: "boda-ana" }))).toBe(
      "slugTaken",
    );
    const c = await createClient(e, { name: "C", slug: "cc" });
    expect(await code(updateClient(e, c.id, { slug: "BODA-ana" }))).toBe(
      "slugTaken",
    );
  });

  it("slugTaken (galleries side) sees client slugs, case-insensitively; own gallery excluded", async () => {
    await createClient(e, { name: "A", slug: "acme" });
    await addGallery("g1", "mine");
    expect(await slugTaken(e, "ACME", "g1")).toBe(true);
    expect(await slugTaken(e, "mine", "g1")).toBe(false);
    expect(await slugTaken(e, "mine", "other")).toBe(true);
    expect(await slugTaken(e, "free", "g1")).toBe(false);
  });

  it("uniqueClientSlug avoids reserved, clients and galleries", async () => {
    await createClient(e, { name: "Acme" });
    await addGallery("g1", "acme-2");
    expect(await uniqueClientSlug(e, "Acme")).toBe("acme-3");
    expect(await uniqueClientSlug(e, "Admin")).toBe("admin-2");
    expect(await uniqueClientSlug(e, "???")).toBe("galeria");
  });

  it("two creates from the same name get distinct slugs", async () => {
    const a = await createClient(e, { name: "Same" });
    const b = await createClient(e, { name: "Same" });
    expect([a.slug, b.slug]).toEqual(["same", "same-2"]);
  });

  it("updateClient patches fields; keeps own slug; notFound for unknown id", async () => {
    const c = await createClient(e, { name: "A", slug: "aaa" });
    const u = await updateClient(e, c.id, {
      name: "B",
      slug: "aaa",
      defaultMode: "delivery",
      defaultShowOnHome: true,
      pageEnabled: false,
    });
    expect(u).toMatchObject({
      name: "B",
      slug: "aaa",
      defaultMode: "delivery",
      defaultShowOnHome: true,
      pageEnabled: false,
    });
    expect(await code(updateClient(e, "nope", { name: "x" }))).toBe("notFound");
    expect(await code(updateClient(e, c.id, { slug: "admin" }))).toBe(
      "invalidSlug",
    );
    expect(await code(updateClient(e, c.id, { name: "" }))).toBe("invalidName");
  });

  it("listClients returns album counts in one query, ordered by name", async () => {
    const a = await createClient(e, { name: "Beta" });
    const b = await createClient(e, { name: "Alfa" });
    await addGallery("g1", "s1", a.id);
    await addGallery("g2", "s2", a.id);
    await addGallery("g3", "s3");
    const calls: string[] = [];
    const spy = {
      ...e,
      DB: new Proxy(env.DB, {
        get(t, p) {
          if (p === "prepare")
            return (q: string) => (calls.push(q), t.prepare(q));
          const v = Reflect.get(t, p) as unknown;
          return typeof v === "function" ? (v as () => unknown).bind(t) : v;
        },
      }),
    } as Env;
    const list = await listClients(spy);
    expect(calls.length).toBe(1);
    expect(list.map((c) => [c.name, c.albumCount])).toEqual([
      ["Alfa", 0],
      ["Beta", 2],
    ]);
    expect(list[0]!.id).toBe(b.id);
  });

  it("assignAlbum: a client deleted right before the UPDATE is notFound, not an FK error", async () => {
    const c = await createClient(e, { name: "Gone" });
    await addGallery("g9", "s9");
    const DB = new Proxy(env.DB, {
      get(t, k) {
        const v = (t as never)[k];
        if (k === "prepare")
          return (sql: string) => {
            if (/^UPDATE galleries SET client_id/.test(sql))
              void env.DB.prepare("DELETE FROM clients WHERE id = ?1")
                .bind(c.id)
                .run();
            return (v as (s: string) => unknown).call(t, sql);
          };
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(await code(assignAlbum({ ...env, DB } as Env, "g9", c.id))).toBe(
      "notFound",
    );
    expect(await clientIdOf("g9")).toBeNull();
  });

  it("assign / unassign only set client_id; unknown ids rejected", async () => {
    const c = await createClient(e, { name: "A" });
    await addGallery("g1", "s1");
    await assignAlbum(e, "g1", c.id);
    expect(await clientIdOf("g1")).toBe(c.id);
    expect(await code(assignAlbum(e, "g1", "nope"))).toBe("notFound");
    expect(await code(assignAlbum(e, "nope", c.id))).toBe("notFound");
    expect(await clientIdOf("g1")).toBe(c.id);
    await unassignAlbum(e, "g1");
    expect(await clientIdOf("g1")).toBeNull();
    expect(await code(unassignAlbum(e, "nope"))).toBe("notFound");
    const row = await env.DB.prepare(
      "SELECT slug, title, status, mode FROM galleries WHERE id='g1'",
    ).first();
    expect(row).toMatchObject({ slug: "s1", title: "T", status: "draft" });
  });

  it("deleteClient unassigns its albums, keeps them, leaves no client row; other clients untouched", async () => {
    const a = await createClient(e, { name: "A" });
    const b = await createClient(e, { name: "B" });
    await addGallery("g1", "s1", a.id);
    await addGallery("g2", "s2", a.id);
    await addGallery("g3", "s3", b.id);
    await deleteClient(e, a.id);
    expect(await getClient(e, a.id)).toBeNull();
    expect(await clientIdOf("g1")).toBeNull();
    expect(await clientIdOf("g2")).toBeNull();
    expect(await clientIdOf("g3")).toBe(b.id);
    const n = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM galleries",
    ).first<{ n: number }>();
    expect(n!.n).toBe(3);
    expect(await code(deleteClient(e, a.id))).toBe("notFound");
  });

  it("deleteClient is one batch within D1 limits, however many albums", async () => {
    const c = await createClient(e, { name: "Big" });
    const max = { params: 0, batch: 0, batches: 0, prepares: 0 };
    const spy = {
      ...e,
      DB: new Proxy(env.DB, {
        get(t, p) {
          if (p === "batch")
            return (s: unknown[]) => (
              max.batches++,
              (max.batch = Math.max(max.batch, s.length)),
              t.batch(s as D1PreparedStatement[])
            );
          if (p === "prepare")
            return (q: string) => {
              max.prepares++;
              const st = t.prepare(q);
              const b = st.bind.bind(st);
              st.bind = (...v: unknown[]) => (
                (max.params = Math.max(max.params, v.length)),
                b(...v)
              );
              return st;
            };
          const v = Reflect.get(t, p) as unknown;
          return typeof v === "function" ? (v as () => unknown).bind(t) : v;
        },
      }),
    } as Env;
    for (let i = 0; i < 150; i++) await addGallery(`g${i}`, `s${i}`, c.id);
    await deleteClient(spy, c.id);
    expect(max.batches).toBe(1);
    expect(max.batch).toBeLessThanOrEqual(D1_BATCH_MAX);
    expect(max.params).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    expect(await clientIdOf("g149")).toBeNull();
  });

  it("deleting a gallery needs no client cleanup (clients row stays, none points at it)", async () => {
    const c = await createClient(e, { name: "A" });
    await addGallery("g1", "s1", c.id);
    await run("DELETE FROM galleries WHERE id = 'g1'");
    expect(await getClient(e, c.id)).not.toBeNull();
  });
});

describe("T6.40a table coverage (client_id)", () => {
  it("every table with a client_id column or an FK to clients is known and handled", async () => {
    const tables = (
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
      ).all<{ name: string }>()
    ).results.map((r) => r.name);
    const hit: string[] = [];
    for (const t of tables) {
      const cols = (
        await env.DB.prepare(`SELECT name FROM pragma_table_info('${t}')`).all<{
          name: string;
        }>()
      ).results.map((c) => c.name);
      const fks = (
        await env.DB.prepare(
          `SELECT "table" AS t FROM pragma_foreign_key_list('${t}')`,
        ).all<{
          t: string;
        }>()
      ).results.map((f) => f.t);
      if (cols.includes("client_id") || fks.includes("clients")) hit.push(t);
    }
    // galleries.client_id is SET NULL by deleteClient; a new table must be added
    // to deleteClient (and here) so a client deletion leaves no rows.
    expect(hit.sort()).toEqual(["galleries"]);
    expect(GALLERY_TABLES).toContain("galleries");
    expect(Object.keys(EXEMPT_TABLES)).not.toContain("clients");
  });
});

describe("T6.40a reserved slugs vs routes", () => {
  it("every top-level static route segment is reserved", () => {
    const tops = new Set<string>();
    const walk = (rs: { path?: string; children?: unknown[] }[]) => {
      for (const r of rs) {
        const seg = r.path?.split("/")[0];
        if (seg && !seg.startsWith(":") && seg !== "*") tops.add(seg);
      }
    };
    walk(routes as { path?: string }[]);
    expect(tops.size).toBeGreaterThan(5);
    for (const t of tops) expect(RESERVED_SLUGS, t).toContain(t);
  });
});
