import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { activityData } from "../app/routes/admin.g.$id.activity";
import { csvResponse } from "../app/routes/admin.g.$id.activity-csv";
import { favoritesData } from "../app/routes/admin.g.$id.favorites";
import { txtResponse } from "../app/routes/admin.g.$id.favorites-txt";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const nonAdmin = { ...e, ALLOW_DEV_ADMIN: "0" } as Env;
const db = getDb(env);
const G = "00000000-0000-4000-8000-0000000000d1";
const G2 = "00000000-0000-4000-8000-0000000000d2";

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});

const iso = (n: number) =>
  new Date(Date.UTC(2026, 0, 1, 12, 0, 0) + n * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

beforeEach(async () => {
  await env.DB.batch(
    [
      "downloads",
      "gallery_views",
      "favorites",
      "visitors",
      "photos",
      "galleries",
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  for (const [id, slug] of [
    [G, "boda-ana"],
    [G2, "otra"],
  ]) {
    await db.insert(schema.galleries).values({
      id,
      driveFolderId: "f" + id,
      slug,
      title: "T " + slug,
      status: "published",
    });
  }
  await db
    .insert(schema.photos)
    .values([
      ph("p1", G, "Highlights", "IMG_1", 1),
      ph("p2", G, "Highlights", "IMG_2", 2),
      ph("p3", G, "Fiesta", "IMG_3", 3),
      { ...ph("p4", G, "Fiesta", "IMG_4", 4), missingSince: iso(0) },
      ph("px", G2, "Highlights", "OTHER", 1),
    ]);
  await db.insert(schema.visitors).values([
    { id: "v1", galleryId: G, email: "ana@example.com" },
    { id: "v2", galleryId: G, email: "bob@example.com" },
    { id: "va", galleryId: G, email: "anon-1@anon.invalid" },
    { id: "vx", galleryId: G2, email: "x@example.com" },
  ]);
});

function ph(
  id: string,
  galleryId: string,
  setName: string,
  baseName: string,
  sort: number,
) {
  return {
    id,
    galleryId,
    setName,
    baseName,
    driveHighresId: "drive-secret-" + id,
    sort,
  };
}

type Dl = typeof schema.downloads.$inferInsert;
const dl = (id: string, n: number, over: Partial<Dl> = {}): Dl => ({
  id,
  galleryId: G,
  photoId: "p1",
  visitorId: "v1",
  variant: "web",
  kind: "single",
  createdAt: iso(n),
  ...over,
});
const req = (path: string, id = G) =>
  new Request(`http://localhost:5173/admin/g/${id}/${path}`);
const status = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (x) {
    return (x as Response).status;
  }
  return 200;
};

describe("activity loader", () => {
  it("401 for non-admin, 404 unknown gallery", async () => {
    expect(await status(activityData(req("activity"), nonAdmin, G))).toBe(401);
    expect(await status(activityData(req("activity"), e, "nope"))).toBe(404);
  });

  it("summary counts: views, unique visitors with email, photos downloaded, bulk headers", async () => {
    await db.insert(schema.galleryViews).values([
      { galleryId: G, visitorId: "v1", createdAt: iso(1) },
      { galleryId: G, visitorId: "va", createdAt: iso(2) },
      { galleryId: G, visitorId: null, createdAt: iso(3) },
      { galleryId: G2, visitorId: "vx", createdAt: iso(4) },
    ]);
    await db.insert(schema.downloads).values([
      dl("d1", 1),
      dl("d2", 2, { visitorId: "va" }), // anon single still counts as a photo download
      dl("h1", 3, { photoId: null, kind: "bulk", bulkScope: "all" }),
      dl("c1", 4, { kind: "bulk", bulkId: "h1", photoId: "p2" }),
      dl("c2", 5, { kind: "bulk", bulkId: "h1", photoId: "p3" }),
      dl("o1", 6, { galleryId: G2, photoId: "px", visitorId: "vx" }),
    ]);
    const d = await activityData(req("activity"), e, G);
    expect(d.summary).toEqual({ views: 3, visitors: 2, photos: 4, bulks: 1 });
  });

  it("top-level rows are newest first, bulk children nest under their header with a count", async () => {
    await db
      .insert(schema.downloads)
      .values([
        dl("d1", 1),
        dl("h1", 3, { photoId: null, kind: "bulk", bulkScope: "set:Fiesta" }),
        dl("c1", 4, { kind: "bulk", bulkId: "h1", photoId: "p3" }),
        dl("c2", 5, { kind: "bulk", bulkId: "h1", photoId: "p4" }),
        dl("d2", 6, { visitorId: "va", photoId: "p2" }),
      ]);
    const d = await activityData(req("activity"), e, G);
    expect(d.rows.map((r) => r.id)).toEqual(["d2", "h1", "d1"]);
    const h = d.rows[1];
    expect(h.bulk).toMatchObject({ scope: "set:Fiesta", count: 2 });
    expect(h.bulk!.children.map((c) => c.name)).toEqual(["IMG_4", "IMG_3"]);
    expect(h.photoId).toBeNull();
    expect(d.rows[0]).toMatchObject({
      email: null,
      name: "IMG_2",
      set: "Highlights",
      photoId: "p2",
    });
    expect(d.rows[2]).toMatchObject({
      email: "ana@example.com",
      name: "IMG_1",
    });
  });

  it("per-photo bulk rows without a header link stay top-level", async () => {
    await db
      .insert(schema.downloads)
      .values([dl("m1", 1, { kind: "bulk", bulkId: null })]);
    const d = await activityData(req("activity"), e, G);
    expect(d.rows.map((r) => r.id)).toEqual(["m1"]);
  });

  it("paginates 50 per page with a created_at+id cursor, no gaps or dupes on ties", async () => {
    const rows: Dl[] = [];
    for (let i = 0; i < 120; i++) {
      // pairs share the same created_at to exercise the id tiebreaker
      rows.push(dl("r" + String(i).padStart(3, "0"), Math.floor(i / 2)));
    }
    await insertDownloads(rows);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = cursor
        ? `activity?cursor=${encodeURIComponent(cursor)}`
        : "activity";
      const d = await activityData(req(q), e, G);
      expect(d.rows.length).toBeLessThanOrEqual(50);
      seen.push(...d.rows.map((r) => r.id));
      cursor = d.next;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(seen[0]).toBe("r119");
    expect(seen[119]).toBe("r000");
  });

  it("ignores a malformed cursor (first page)", async () => {
    await db.insert(schema.downloads).values([dl("d1", 1)]);
    const d = await activityData(req("activity?cursor=%27%3B--"), e, G);
    expect(d.rows).toHaveLength(1);
    expect(d.next).toBeNull();
  });

  it("filters by visitor email, by anonymous, and by size", async () => {
    await db
      .insert(schema.downloads)
      .values([
        dl("a1", 1),
        dl("a2", 2, { variant: "ig" }),
        dl("b1", 3, { visitorId: "v2" }),
        dl("n1", 4, { visitorId: "va" }),
        dl("n2", 5, { visitorId: null }),
      ]);
    const ids = async (q: string) =>
      (await activityData(req("activity" + q), e, G)).rows.map((r) => r.id);
    expect(await ids("?visitor=ana@example.com")).toEqual(["a2", "a1"]);
    expect(await ids("?visitor=ANA@example.com")).toEqual(["a2", "a1"]);
    expect(await ids("?visitor=anon")).toEqual(["n2", "n1"]);
    expect(await ids("?size=ig")).toEqual(["a2"]);
    expect(await ids("?visitor=ana@example.com&size=web")).toEqual(["a1"]);
    expect(await ids("?size=bogus")).toHaveLength(5);
    const d = await activityData(req("activity?visitor=bob@example.com"), e, G);
    expect(d.filters).toEqual({ visitor: "bob@example.com", size: "" });
    expect(d.visitorOptions).toEqual(["ana@example.com", "bob@example.com"]);
  });

  it("filter applies to bulk headers; children follow the header", async () => {
    await db.insert(schema.downloads).values([
      dl("h1", 1, {
        photoId: null,
        kind: "bulk",
        bulkScope: "all",
        variant: "ig",
      }),
      dl("c1", 2, { kind: "bulk", bulkId: "h1", variant: "ig" }),
      dl("d1", 3),
    ]);
    const d = await activityData(req("activity?size=ig"), e, G);
    expect(d.rows.map((r) => r.id)).toEqual(["h1"]);
    expect(d.rows[0].bulk!.count).toBe(1);
  });

  it("visits mini-table: latest first, anon/no visitor as null email, scoped to the gallery", async () => {
    await db.insert(schema.galleryViews).values([
      { galleryId: G, visitorId: "v1", country: "AR", createdAt: iso(1) },
      { galleryId: G, visitorId: "va", country: "UY", createdAt: iso(2) },
      { galleryId: G, visitorId: null, country: null, createdAt: iso(3) },
      { galleryId: G2, visitorId: "vx", country: "BR", createdAt: iso(4) },
    ]);
    const d = await activityData(req("activity"), e, G);
    expect(d.views.map((v) => [v.email, v.country])).toEqual([
      [null, null],
      [null, "UY"],
      ["ana@example.com", "AR"],
    ]);
  });

  it("never exposes drive ids or tokens", async () => {
    await db.insert(schema.downloads).values([dl("d1", 1)]);
    const s = JSON.stringify(await activityData(req("activity"), e, G));
    expect(s).not.toContain("drive-secret");
    expect(s).not.toContain("driveFolderId");
  });
});

async function readAll(res: Response) {
  // Response.text() strips the BOM; keep it to assert on it.
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    await res.arrayBuffer(),
  );
}

async function insertDownloads(rows: Dl[]) {
  for (let i = 0; i < rows.length; i += 10) {
    await db.insert(schema.downloads).values(rows.slice(i, i + 10));
  }
}

describe("activity CSV", () => {
  it("401 / 404", async () => {
    expect(await status(csvResponse(req("activity.csv"), nonAdmin, G))).toBe(
      401,
    );
    expect(await status(csvResponse(req("activity.csv"), e, "nope"))).toBe(404);
  });

  it("headers: csv, attachment <slug>-actividad.csv, no-store", async () => {
    const res = await csvResponse(req("activity.csv"), e, G);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/csv/);
    expect(res.headers.get("Content-Disposition")).toContain(
      'filename="boda-ana-actividad.csv"',
    );
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("starts with BOM + header; columns, AR time, empty email for anon, bulk id", async () => {
    await db.insert(schema.downloads).values([
      dl("d1", 0, { country: "AR" }),
      dl("h1", 1, {
        photoId: null,
        kind: "bulk",
        bulkScope: "all",
        visitorId: "va",
      }),
      dl("c1", 2, {
        kind: "bulk",
        bulkId: "h1",
        photoId: "p3",
        variant: "highres",
        visitorId: "va",
      }),
    ]);
    const text = await readAll(await csvResponse(req("activity.csv"), e, G));
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      "Fecha (UTC),Fecha (AR),Email del visitante,Foto,Set,Tamaño,Tipo,ID descarga completa,País,Región,Ciudad,Continente,Zona horaria,ASN,Organización de red,Idioma,Origen,Navegador,Versión,Sistema,Dispositivo",
    );
    // newest first
    expect(lines[1]).toBe(
      "2026-01-01T12:00:02Z,2026-01-01 09:00:02,,IMG_3,Fiesta,Alta resolución,completa,h1,,,,,,,,,,,,,",
    );
    expect(lines[2]).toBe(
      "2026-01-01T12:00:01Z,2026-01-01 09:00:01,,,,Web,completa,h1,,,,,,,,,,,,,",
    );
    expect(lines[3]).toBe(
      "2026-01-01T12:00:00Z,2026-01-01 09:00:00,ana@example.com,IMG_1,Highlights,Web,individual,,AR,,,,,,,,,,,,",
    );
    expect(lines[4]).toBe("");
    expect(lines).toHaveLength(5);
  });

  it("escapes commas/quotes and neutralises formulas in names and emails", async () => {
    await db
      .insert(schema.photos)
      .values([{ ...ph("pf", G, 'Set, "uno"', "=CMD|' /C calc'!A0", 9) }]);
    await db
      .insert(schema.visitors)
      .values({ id: "vf", galleryId: G, email: "+evil@example.com" });
    await db
      .insert(schema.downloads)
      .values([dl("d1", 1, { photoId: "pf", visitorId: "vf" })]);
    const text = await readAll(await csvResponse(req("activity.csv"), e, G));
    const line = text.split("\r\n")[1];
    expect(line).toContain(",'+evil@example.com,");
    expect(line).toContain(",'=CMD|' /C calc'!A0,");
    expect(line).toContain(',"Set, ""uno""",');
  });

  it("streams every row (500) and only this gallery", async () => {
    const rows: Dl[] = [];
    for (let i = 0; i < 500; i++)
      rows.push(dl("s" + String(i).padStart(3, "0"), i));
    rows.push(
      dl("other", 1, { galleryId: G2, photoId: "px", visitorId: "vx" }),
    );
    await insertDownloads(rows);
    const res = await csvResponse(req("activity.csv"), e, G);
    expect(res.body).toBeInstanceOf(ReadableStream);
    const text = await readAll(res);
    const lines = text.slice(1).split("\r\n");
    expect(lines).toHaveLength(1 + 500 + 1);
    expect(new Set(lines.slice(1, 501)).size).toBe(500);
    expect(text).not.toContain("OTHER");
  });
});

describe("favorites loader", () => {
  const fav = (
    visitorId: string,
    photoId: string,
    n: number,
    listName = "Favoritos",
  ) => ({
    galleryId: G,
    visitorId,
    photoId,
    listName,
    createdAt: iso(n),
  });

  it("401 / 404", async () => {
    expect(await status(favoritesData(req("favorites"), nonAdmin, G))).toBe(
      401,
    );
    expect(await status(favoritesData(req("favorites"), e, "nope"))).toBe(404);
  });

  it("groups per visitor+list with count and last activity; anon only when they have favorites", async () => {
    await db
      .insert(schema.favorites)
      .values([
        fav("v1", "p1", 1),
        fav("v1", "p2", 5),
        fav("v2", "p2", 3),
        fav("va", "p3", 4),
      ]);
    // v2 has no downloads/favs other; vx other gallery has favs
    await db.insert(schema.favorites).values({
      galleryId: G2,
      visitorId: "vx",
      photoId: "px",
      createdAt: iso(9),
    });
    const d = await favoritesData(req("favorites"), e, G);
    expect(d.visitors.map((v) => v.label)).toEqual([
      "ana@example.com",
      "Anónimo #va",
      "bob@example.com",
    ]);
    const ana = d.visitors[0];
    expect(ana.lists).toHaveLength(1);
    expect(ana.lists[0]).toMatchObject({
      name: "Favoritos",
      count: 2,
      last: iso(5),
    });
    expect(ana.lists[0].photos.map((p) => p.name).sort()).toEqual([
      "IMG_1",
      "IMG_2",
    ]);
    expect(d.visitors[1].anon).toBe(true);
    expect(d.visitors[0].anon).toBe(false);
  });

  it("a visitor without favorites does not appear (anon without favs neither)", async () => {
    const d = await favoritesData(req("favorites"), e, G);
    expect(d.visitors).toEqual([]);
    expect(d.all).toEqual([]);
  });

  it("hidden (missing) photos are listed flagged, not hidden", async () => {
    await db
      .insert(schema.favorites)
      .values([fav("v1", "p3", 1), fav("v1", "p4", 2)]);
    const d = await favoritesData(req("favorites"), e, G);
    const ps = d.visitors[0].lists[0].photos;
    expect(ps.find((p) => p.name === "IMG_4")).toMatchObject({ hidden: true });
    expect(ps.find((p) => p.name === "IMG_3")).toMatchObject({ hidden: false });
    expect(d.visitors[0].lists[0].count).toBe(2);
  });

  it("union across visitors with how many visitors picked each, most picked first", async () => {
    await db.insert(schema.favorites).values([
      fav("v1", "p1", 1),
      fav("v1", "p2", 2),
      fav("v1", "p2", 3, "Álbum"), // same visitor, other list: counts once
      fav("v2", "p2", 3),
      fav("va", "p2", 4),
      fav("va", "p3", 4),
    ]);
    const d = await favoritesData(req("favorites"), e, G);
    expect(d.all.map((p) => [p.name, p.picks])).toEqual([
      ["IMG_2", 3],
      ["IMG_1", 1],
      ["IMG_3", 1],
    ]);
  });
});

describe("favorites txt", () => {
  const fav = (visitorId: string, photoId: string, n: number) => ({
    galleryId: G,
    visitorId,
    photoId,
    createdAt: iso(n),
  });
  beforeEach(async () => {
    await db.insert(schema.favorites).values([
      fav("v1", "p1", 1),
      fav("v1", "p4", 2), // hidden (missing)
      fav("v2", "p2", 3),
      fav("v2", "p1", 4),
    ]);
  });

  it("401 / 404", async () => {
    expect(await status(txtResponse(req("favorites.txt"), nonAdmin, G))).toBe(
      401,
    );
    expect(await status(txtResponse(req("favorites.txt"), e, "nope"))).toBe(
      404,
    );
  });

  it("one visitor: one name per line, existing photos only, utf-8 attachment", async () => {
    const res = await txtResponse(req("favorites.txt?visitor=v1"), e, G);
    expect(res.headers.get("Content-Type")).toMatch(
      /^text\/plain; charset=utf-8/,
    );
    expect(res.headers.get("Content-Disposition")).toContain(
      "boda-ana-favoritos",
    );
    expect(res.headers.get("Content-Disposition")).toContain(".txt");
    expect(await res.text()).toBe("IMG_1\n");
  });

  it("no visitor param: union of everyone, deduped, existing only", async () => {
    const res = await txtResponse(req("favorites.txt"), e, G);
    expect((await res.text()).split("\n").sort()).toEqual([
      "",
      "IMG_1",
      "IMG_2",
    ]);
  });

  it("unknown visitor -> 404; visitor of another gallery -> 404", async () => {
    expect(
      await status(txtResponse(req("favorites.txt?visitor=nope"), e, G)),
    ).toBe(404);
    expect(
      await status(txtResponse(req("favorites.txt?visitor=vx"), e, G)),
    ).toBe(404);
  });
});
