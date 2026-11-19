import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { gallerySessionCookie, pinFingerprint } from "../app/lib/server/auth";
import { loadGallery } from "../app/lib/server/gallery";
import {
  handleBulk,
  handleDownloadTokens,
  serveDownload,
} from "../app/lib/server/downloads";
import { handleVisitor } from "../app/lib/server/favorites";
import type { DriveClient } from "../app/lib/server/drive-types";
import { activityData } from "../app/routes/admin.g.$id.activity";
import { csvResponse } from "../app/routes/admin.g.$id.activity-csv";
import { csvCell } from "../app/lib/admin-activity";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000e1";
const BASE = "https://session.test";
const IP4 = "203.0.113.77";
const IP6 = "2001:db8:abcd:12:aaaa:bbbb:cccc:dddd";
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const nonAdmin = { ...e, ALLOW_DEV_ADMIN: "0" } as Env;

const CF = {
  country: "AR",
  region: "Buenos Aires",
  city: "Villa Luro",
  continent: "SA",
  timezone: "America/Argentina/Buenos_Aires",
  asn: 7303,
  asOrganization: "Telecom Argentina S.A.",
};
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const HDRS = (ip = IP4) => ({
  "CF-Connecting-IP": ip,
  "Accept-Language": "es-AR,es;q=0.9",
  Referer: "https://l.instagram.com/?u=secret-path",
  "User-Agent": UA_IPHONE,
});

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables(
    "downloads",
    "gallery_views",
    "favorites",
    "visitors",
    "rate_limits",
    "photos",
    "galleries",
  );
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f-drive-SECRET",
    slug: "boda",
    title: "Boda",
    status: "published",
    requireEmail: false,
  });
  await db.insert(schema.photos).values({
    id: "p1",
    galleryId: G,
    baseName: "IMG_1",
    driveHighresId: "hr-1",
    driveWebId: "web-1",
    width: 3000,
    height: 2000,
    sort: 1,
  });
});

const nav = (
  headers: Record<string, string>,
  cf?: object,
  url = `${BASE}/boda`,
) =>
  new Request(url, {
    headers: { "Sec-Fetch-Mode": "navigate", ...headers },
    ...(cf ? { cf } : {}),
  } as RequestInit);

const drive = {
  async streamFile() {
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      headers: { "Content-Length": "4", "Content-Type": "image/jpeg" },
    });
  },
} as unknown as DriveClient;

async function downloadOnce(headers: Record<string, string>, cf?: object) {
  const res = await handleDownloadTokens(
    new Request(`${BASE}/api/g/boda/download-tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ photoIds: ["p1"], variant: "web" }),
    }),
    "boda",
    env,
  );
  const body = (await res.json()) as { tokens: { url: string }[] };
  const token = body.tokens[0].url.replace("/dl/", "");
  return serveDownload(
    new Request(`${BASE}/dl/${token}`, {
      headers,
      ...(cf ? { cf } : {}),
    } as RequestInit),
    token,
    { ...env, DRIVE_MODE: "google" } as Env,
    { drive },
  );
}

const rows = (t: string) =>
  env.DB.prepare(`SELECT * FROM ${t}`)
    .all<Record<string, unknown>>()
    .then((r) => r.results);

async function dumpEverything() {
  const tables = (
    await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'",
    ).all<{ name: string }>()
  ).results;
  let out = "";
  for (const t of tables) out += JSON.stringify(await rows(t.name));
  return out;
}

describe("view logging stores the visitor info, never the raw IP", () => {
  it("cookieless view: every new column filled, IP hashed", async () => {
    await loadGallery(nav(HDRS(), CF), "boda", env);
    const [v] = await rows("gallery_views");
    expect(v).toMatchObject({
      country: "AR",
      region: "Buenos Aires",
      city: "Villa Luro",
      continent: "SA",
      timezone: "America/Argentina/Buenos_Aires",
      asn: 7303,
      as_org: "Telecom Argentina S.A.",
      lang: "es-AR",
      referrer_host: "l.instagram.com",
      browser: "Safari",
      browser_version: "17",
      os: "iOS",
      device: "mobile",
    });
    expect(v.ip_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("view with a visitor session logs the same fields", async () => {
    const pf = await pinFingerprint(null, env);
    const cookie = (
      await gallerySessionCookie(
        { galleryId: G, pf, unlocked: true, visitorId: "vv1" },
        env,
        { secure: false },
      )
    ).split(";")[0];
    await db
      .insert(schema.visitors)
      .values({ id: "vv1", galleryId: G, email: "a@b.co" });
    await loadGallery(nav({ ...HDRS(), Cookie: cookie }, CF), "boda", env);
    const [v] = await rows("gallery_views");
    expect(v).toMatchObject({
      visitor_id: "vv1",
      city: "Villa Luro",
      device: "mobile",
    });
  });

  it("missing request.cf stores nulls and does not crash", async () => {
    const r = await loadGallery(nav({ "CF-Connecting-IP": IP4 }), "boda", env);
    expect(r.data.state).toBe("open");
    const [v] = await rows("gallery_views");
    expect(v).toMatchObject({
      country: null,
      region: null,
      city: null,
      asn: null,
      as_org: null,
      lang: null,
      referrer_host: null,
      browser: null,
      device: "unknown",
    });
  });

  it("oversized and malformed headers never break view logging", async () => {
    await loadGallery(
      nav(
        {
          "CF-Connecting-IP": IP4,
          "Accept-Language": "x".repeat(8000),
          Referer: "https://" + "a".repeat(5000) + ".com/",
          "User-Agent": "Chrome/".repeat(5000),
        },
        { city: "c".repeat(5000), asOrganization: "o".repeat(5000) },
      ),
      "boda",
      env,
    );
    const [v] = await rows("gallery_views");
    expect(v).toBeTruthy();
    expect((v.city as string).length).toBeLessThanOrEqual(100);
    expect(v.lang).toBeNull();
    expect(v.referrer_host).toBeNull();
  });

  it("same-site referrer is stored as null", async () => {
    await loadGallery(
      nav({ ...HDRS(), Referer: `${BASE}/other` }, CF),
      "boda",
      env,
    );
    expect((await rows("gallery_views"))[0].referrer_host).toBeNull();
  });
});

describe("download logging", () => {
  it("stores ip_hash, the same fields as views and the truncated raw UA", async () => {
    const res = await downloadOnce(HDRS(), CF);
    expect(res.status).toBe(200);
    const [d] = await rows("downloads");
    expect(d).toMatchObject({
      country: "AR",
      city: "Villa Luro",
      as_org: "Telecom Argentina S.A.",
      lang: "es-AR",
      referrer_host: "l.instagram.com",
      browser: "Safari",
      os: "iOS",
      device: "mobile",
      ua: UA_IPHONE.slice(0, 200),
    });
    expect(d.ip_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("the view and the download of one IP share the same ip_hash", async () => {
    await loadGallery(nav(HDRS(), CF), "boda", env);
    await downloadOnce(HDRS(), CF);
    expect((await rows("downloads"))[0].ip_hash).toBe(
      (await rows("gallery_views"))[0].ip_hash,
    );
  });

  it("bulk header rows carry the info too", async () => {
    const res = await handleBulk(
      new Request(`${BASE}/api/g/boda/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...HDRS() },
        body: JSON.stringify({ scope: "all", variant: "web" }),
        cf: CF,
      } as RequestInit),
      "boda",
      env,
    );
    expect(res.status).toBe(200);
    const hdr = (await rows("downloads")).find((r) => r.photo_id === null);
    expect(hdr).toMatchObject({ city: "Villa Luro", device: "mobile" });
    expect(hdr?.ip_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("missing cf stores nulls", async () => {
    await downloadOnce({ "CF-Connecting-IP": IP4 });
    expect((await rows("downloads"))[0]).toMatchObject({
      city: null,
      asn: null,
      device: "unknown",
    });
  });
});

describe("no raw IP ever reaches the database", () => {
  it("scans every column of every table after views, visitors, tokens, bulk and downloads", async () => {
    for (const ip of [IP4, IP6]) {
      await loadGallery(nav(HDRS(ip), CF), "boda", env);
      await handleVisitor(
        new Request(`${BASE}/api/g/boda/visitor`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...HDRS(ip) },
          body: JSON.stringify({ email: "x@example.com" }),
          cf: CF,
        } as RequestInit),
        "boda",
        env,
      );
      await handleBulk(
        new Request(`${BASE}/api/g/boda/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...HDRS(ip) },
          body: JSON.stringify({ scope: "all", variant: "web" }),
          cf: CF,
        } as RequestInit),
        "boda",
        env,
      );
      await downloadOnce(HDRS(ip), CF);
      // Hostile: the IP smuggled in every header we read.
      await loadGallery(
        nav(
          {
            "CF-Connecting-IP": ip,
            "Accept-Language": "es",
            Referer: `https://${ip.includes(":") ? "example.com" : ip}/x`,
          },
          CF,
        ),
        "boda",
        env,
      );
    }
    const dump = await dumpEverything();
    expect(dump.length).toBeGreaterThan(200);
    for (const needle of [IP4, IP6, "2001:db8", "203.0.113"])
      expect(dump).not.toContain(needle);
  });
});

describe("public payload", () => {
  it("nothing new reaches the loader data of the public gallery", async () => {
    const r = await loadGallery(nav(HDRS(), CF), "boda", env);
    const json = JSON.stringify(r);
    for (const needle of [
      "Villa Luro",
      "Telecom",
      "l.instagram.com",
      "7303",
      "ip_hash",
      "ipHash",
      "asOrg",
      "referrerHost",
      "browser",
      'device"',
    ])
      expect(json).not.toContain(needle);
    const [v] = await rows("gallery_views");
    expect(json).not.toContain(v.ip_hash as string);
  });
});

describe("admin: Actividad data and CSV", { timeout: 20_000 }, () => {
  const req = (p: string) =>
    new Request(`http://localhost:5173/admin/g/${G}/${p}`);
  const status = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (x) {
      return (x as Response).status;
    }
    return 200;
  };
  async function seed() {
    await loadGallery(nav(HDRS(), CF), "boda", env);
    await loadGallery(
      nav(
        {
          ...HDRS("198.51.100.5"),
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36",
        },
        { ...CF, country: "UY", city: "Montevideo" },
      ),
      "boda",
      env,
    );
    await downloadOnce(HDRS(), CF);
  }

  it("only admins read the new data (401 for non-admin, JSON and CSV)", async () => {
    await seed();
    expect(await status(activityData(req("activity"), nonAdmin, G))).toBe(401);
    expect(await status(csvResponse(req("activity.csv"), nonAdmin, G))).toBe(
      401,
    );
  });

  it("rows and visits carry location, device, browser, os, referrer and language; no ip_hash", async () => {
    await seed();
    const d = await activityData(req("activity"), e, G);
    expect(d.rows[0]).toMatchObject({
      city: "Villa Luro",
      region: "Buenos Aires",
      country: "AR",
      device: "mobile",
      browser: "Safari",
      browserVersion: "17",
      os: "iOS",
      referrerHost: "l.instagram.com",
      lang: "es-AR",
    });
    expect(d.views.map((v) => v.city).sort()).toEqual([
      "Montevideo",
      "Villa Luro",
    ]);
    expect(JSON.stringify(d)).not.toMatch(/ip_?hash/i);
    const [v] = await rows("gallery_views");
    expect(JSON.stringify(d)).not.toContain(v.ip_hash as string);
  });

  it("per-gallery breakdown: top countries, devices, browsers, referrers", async () => {
    await seed();
    const d = await activityData(req("activity"), e, G);
    expect(d.breakdown.countries).toEqual(
      expect.arrayContaining([
        { value: "AR", count: 1 },
        { value: "UY", count: 1 },
      ]),
    );
    expect(d.breakdown.devices).toEqual(
      expect.arrayContaining([
        { value: "mobile", count: 1 },
        { value: "desktop", count: 1 },
      ]),
    );
    expect(d.breakdown.browsers).toEqual(
      expect.arrayContaining([
        { value: "Safari", count: 1 },
        { value: "Chrome", count: 1 },
      ]),
    );
    expect(d.breakdown.referrers).toEqual([
      { value: "l.instagram.com", count: 2 },
    ]);
  });

  it("breakdown is limited per gallery and capped at 5 entries", async () => {
    await db.insert(schema.galleries).values({
      id: "other",
      driveFolderId: "fo",
      slug: "otra",
      title: "O",
      status: "published",
    });
    await db.insert(schema.galleryViews).values([
      ...["A1", "A2", "A3", "A4", "A5", "A6", "A7"].map((c) => ({
        galleryId: G,
        country: c,
      })),
      { galleryId: "other", country: "ZZ" },
    ]);
    const d = await activityData(req("activity"), e, G);
    expect(d.breakdown.countries).toHaveLength(5);
    expect(d.breakdown.countries.map((c) => c.value)).not.toContain("ZZ");
  });

  it("CSV: translated headers and the new columns (es and en)", async () => {
    await seed();
    const read = async (lang: string) => {
      const res = await csvResponse(
        new Request(`http://localhost:5173/admin/g/${G}/activity.csv`, {
          headers: { Cookie: `admin_lang=${lang}` },
        }),
        e,
        G,
      );
      return (await res.text()).replace(/^\uFEFF/, "").split("\r\n");
    };
    const es = await read("es");
    expect(es[0]).toBe(
      "Fecha (UTC),Fecha (AR),Email del visitante,Foto,Set,Tamaño,Tipo,ID descarga completa,País,Región,Ciudad,Continente,Zona horaria,ASN,Organización de red,Idioma,Origen,Navegador,Versión,Sistema,Dispositivo",
    );
    expect(es[1]).toContain(
      ",AR,Buenos Aires,Villa Luro,SA,America/Argentina/Buenos_Aires,7303,Telecom Argentina S.A.,es-AR,l.instagram.com,Safari,17,iOS,mobile",
    );
    const en = await read("en");
    expect(en[0]).toContain(
      ",Country,Region,City,Continent,Time zone,ASN,Network organization,Language,Referrer,Browser,Version,OS,Device",
    );
    expect(es.join("\n")).not.toMatch(/ip_?hash/i);
  });

  it("CSV injection: new columns are guarded for = + - @ tab CR", async () => {
    const evil = [
      "=cmd|' /C calc'!A0",
      "+1+1",
      "-2+3",
      "@SUM(A1)",
      "\tTAB",
      "\rCR",
    ];
    for (const [i, v] of evil.entries()) {
      await env.DB.prepare(
        `INSERT INTO downloads (id, gallery_id, photo_id, variant, kind, created_at,
           region, city, continent, timezone, as_org, lang, referrer_host, browser, browser_version, os, device)
         VALUES (?1, ?2, 'p1', 'web', 'single', ?3, ?4, ?4, 'SA', ?4, ?4, ?4, ?4, ?4, substr(?4, 1, 9), ?4, 'desktop')`,
      )
        .bind(`inj${i}`, G, `2026-01-01T12:00:0${i}Z`, v)
        .run();
    }
    const res = await csvResponse(req("activity.csv"), e, G);
    const text = (await res.text()).replace(/^\uFEFF/, "");
    for (const v of evil) {
      const guarded = csvCell(v);
      expect(guarded.replace(/^"/, "")).toMatch(/^'/);
      expect(text).toContain(guarded);
    }
    // no cell of any data row starts with a formula trigger
    const cells = text
      .split("\r\n")
      .slice(1)
      .filter(Boolean)
      .flatMap((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [])
      .map((c) => c.replace(/,$/, "").replace(/^"/, ""));
    for (const c of cells) expect(c).not.toMatch(/^[=+\-@\t\r]/);
  });
});
