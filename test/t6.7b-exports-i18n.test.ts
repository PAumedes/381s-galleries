import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { cardData } from "../app/routes/admin.g.$id.card";
import { csvResponse } from "../app/routes/admin.g.$id.activity-csv";
import { txtResponse } from "../app/routes/admin.g.$id.favorites-txt";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const G = "00000000-0000-4000-8000-0000000000e1";

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  await resetTables(
    "downloads",
    "favorites",
    "visitors",
    "photos",
    "galleries",
  );
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "boda-ana",
    title: "Boda Ana",
    status: "published",
    eventDate: "2026-11-01",
  });
  await db.insert(schema.photos).values({
    id: "p1",
    galleryId: G,
    setName: "Highlights",
    baseName: "IMG_1",
    driveHighresId: "d1",
    sort: 1,
  });
  await db.insert(schema.visitors).values({
    id: "v1",
    galleryId: G,
    email: "ana@example.com",
  });
  await db.insert(schema.favorites).values({
    galleryId: G,
    visitorId: "v1",
    photoId: "p1",
    listName: "Favoritos",
    createdAt: "2026-01-01T12:00:00Z",
  });
  await db.insert(schema.downloads).values([
    {
      id: "d1",
      galleryId: G,
      photoId: "p1",
      visitorId: "v1",
      variant: "highres",
      kind: "single",
      createdAt: "2026-01-01T12:00:00Z",
    },
    {
      id: "h1",
      galleryId: G,
      photoId: null,
      visitorId: "v1",
      variant: "web",
      kind: "bulk",
      bulkScope: "all",
      createdAt: "2026-01-01T12:00:01Z",
    },
  ]);
});

const adminReq = (path: string, cookie?: string) =>
  new Request(`http://localhost:5173/admin/g/${G}/${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });

async function text(res: Response) {
  // Response.text() strips the BOM; keep it (the CSV tests slice it off).
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    await res.arrayBuffer(),
  );
}

const CSV_ES =
  "Fecha (UTC),Fecha (AR),Email del visitante,Foto,Set,Tamaño,Tipo,ID descarga completa,País,Región,Ciudad,Continente,Zona horaria,ASN,Organización de red,Idioma,Origen,Navegador,Versión,Sistema,Dispositivo";
const CSV_EN =
  "Date (UTC),Date (AR),Visitor email,Photo,Set,Size,Type,Bulk ID,Country,Region,City,Continent,Time zone,ASN,Network organization,Language,Referrer,Browser,Version,OS,Device";

describe("activity CSV follows the admin language", () => {
  it.each([
    ["no cookie", undefined],
    ["invalid cookie", "admin_lang=fr"],
    ["wrong case", "admin_lang=EN"],
    ["es cookie", "admin_lang=es"],
  ])("Spanish for %s", async (_n, cookie) => {
    const res = await csvResponse(adminReq("activity.csv", cookie), e, G);
    expect(res.headers.get("Content-Disposition")).toContain(
      'filename="boda-ana-actividad.csv"',
    );
    const lines = (await text(res)).slice(1).split("\r\n");
    expect(lines[0]).toBe(CSV_ES);
    expect(lines[1]).toBe(
      "2026-01-01T12:00:01Z,2026-01-01 09:00:01,ana@example.com,,,Web,completa,h1,,,,,,,,,,,,,",
    );
    expect(lines[2]).toBe(
      "2026-01-01T12:00:00Z,2026-01-01 09:00:00,ana@example.com,IMG_1,Highlights,Alta resolución,individual,,,,,,,,,,,,,,",
    );
  });

  it("English with admin_lang=en (labels only; ISO/AR dates unchanged)", async () => {
    const res = await csvResponse(
      adminReq("activity.csv", "theme=x; admin_lang=en"),
      e,
      G,
    );
    expect(res.headers.get("Content-Disposition")).toContain(
      'filename="boda-ana-activity.csv"',
    );
    const lines = (await text(res)).slice(1).split("\r\n");
    expect(lines[0]).toBe(CSV_EN);
    expect(lines[1]).toBe(
      "2026-01-01T12:00:01Z,2026-01-01 09:00:01,ana@example.com,,,Web,bulk,h1,,,,,,,,,,,,,",
    );
    expect(lines[2]).toBe(
      "2026-01-01T12:00:00Z,2026-01-01 09:00:00,ana@example.com,IMG_1,Highlights,High resolution,single,,,,,,,,,,,,,,",
    );
  });

  it("keeps the formula guard in both languages", async () => {
    await db.insert(schema.photos).values({
      id: "pf",
      galleryId: G,
      setName: "@set",
      baseName: "=1+1",
      driveHighresId: "d2",
      sort: 2,
    });
    await db.insert(schema.downloads).values({
      id: "d9",
      galleryId: G,
      photoId: "pf",
      visitorId: "v1",
      variant: "web",
      kind: "single",
      createdAt: "2026-01-01T12:00:05Z",
    });
    for (const c of ["admin_lang=es", "admin_lang=en"]) {
      const t = await text(
        await csvResponse(adminReq("activity.csv", c), e, G),
      );
      expect(t.split("\r\n")[1]).toContain(",'=1+1,'@set,");
    }
  });
});

describe("favorites .txt follows the admin language", () => {
  it("Spanish by default and for an invalid cookie, same body", async () => {
    for (const c of [undefined, "admin_lang=zz"]) {
      const res = await txtResponse(adminReq("favorites.txt", c), e, G);
      expect(res.headers.get("Content-Disposition")).toContain(
        'filename="boda-ana-favoritos.txt"',
      );
      expect(await res.text()).toBe("IMG_1\n");
    }
  });
  it("English filename with admin_lang=en, with and without visitor", async () => {
    const res = await txtResponse(
      adminReq("favorites.txt", "admin_lang=en"),
      e,
      G,
    );
    expect(res.headers.get("Content-Disposition")).toContain(
      'filename="boda-ana-favorites.txt"',
    );
    const v = await txtResponse(
      adminReq("favorites.txt?visitor=v1", "admin_lang=en"),
      e,
      G,
    );
    expect(v.headers.get("Content-Disposition")).toContain(
      'filename="boda-ana-favorites-v1.txt"',
    );
    expect(await v.text()).toBe("IMG_1\n");
  });
});

describe("printable card language", () => {
  const card = (q: string, cookie?: string) =>
    cardData(adminReq(`card${q}`, cookie), e, G).then((d) => d.lang);
  it("defaults to the admin language", async () => {
    expect(await card("")).toBe("es");
    expect(await card("", "admin_lang=en")).toBe("en");
    expect(await card("", "admin_lang=es")).toBe("es");
  });
  it("invalid admin cookie falls back to es", async () => {
    expect(await card("", "admin_lang=fr")).toBe("es");
  });
  it("explicit ?lang wins over the cookie", async () => {
    expect(await card("?lang=en", "admin_lang=es")).toBe("en");
    expect(await card("?lang=es", "admin_lang=en")).toBe("es");
  });
  it("invalid ?lang is ignored (admin language applies)", async () => {
    expect(await card("?lang=xx", "admin_lang=en")).toBe("en");
    expect(await card("?lang=xx")).toBe("es");
  });
});
