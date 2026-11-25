import { env } from "cloudflare:workers";
import { inArray } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { hashPin } from "../app/lib/server/crypto";
import { executionContext } from "../app/lib/server/context";
import {
  CLIENT_PAGE_D1_QUERIES,
  D1_MAX_BOUND_PARAMS,
} from "../app/lib/server/d1-limits";
import { galleryLoader } from "../app/lib/server/gallery-route";
import { CLIENT_PAGE_SIZE, loadHome } from "../app/lib/server/home";
import { parsePageParam } from "../app/lib/server/client-page";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv } from "./support/warm";

const db = getDb(env);
const e = env as Env;
const ORIGIN = "https://gallery.381studios.ar";
const TOTAL = 130; // 3 pages of 60: 60 + 60 + 10
const PIN_AT = [5, 70, 129]; // one on every page (index in newest-first order)

const ctx = () => {
  const c = new RouterContextProvider();
  c.set(executionContext, {
    waitUntil() {},
    passThroughException() {},
  } as never);
  return c;
};

type Out = {
  status: number;
  headers: Headers;
  data: Record<string, unknown> & {
    state?: string;
    page?: number;
    pageCount?: number;
    items?: {
      slug: string;
      locked?: boolean;
      eventDate: string | null;
      cover: { id: string } | null;
    }[];
  };
};
async function load(
  path: string,
  base: Env = e,
  album = path.slice(1).split("?")[0],
): Promise<Out> {
  const r = (await galleryLoader(
    {
      request: new Request(ORIGIN + path, {
        headers: { "Sec-Fetch-Mode": "navigate" },
      }),
      context: ctx(),
    } as never,
    { album },
    base,
  )) as { data: Out["data"]; init: ResponseInit };
  return {
    status: r.init?.status ?? 200,
    headers: new Headers(r.init?.headers),
    data: r.data,
  };
}

const name = (i: number) => `a${String(i).padStart(3, "0")}`;

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("photos", "galleries", "clients");
  await db.insert(schema.clients).values([
    { id: "c-acme", slug: "acme", name: "ACME" },
    { id: "c-small", slug: "small", name: "Small" },
  ]);
  const pin = await hashPin("1234");
  // index 0 is the newest (event dates descend)
  for (let i = 0; i < TOTAL; i++) {
    const slug = name(i);
    const d = new Date(Date.UTC(2026, 0, 1) - i * 86_400_000);
    await db.insert(schema.galleries).values({
      id: `g-${slug}`,
      driveFolderId: `drive-SECRET-${slug}`,
      slug,
      title: `T ${slug}`,
      status: "published",
      showOnHome: false,
      clientId: "c-acme",
      eventDate: d.toISOString().slice(0, 10),
      ...(PIN_AT.includes(i) ? { pinHash: pin } : {}),
    });
    await db.insert(schema.photos).values({
      id: `p-${slug}`,
      galleryId: `g-${slug}`,
      baseName: slug,
      driveHighresId: `hr-SECRET-${slug}`,
      sort: 0,
      width: 3000,
      height: 2000,
    });
  }
  await db.insert(schema.galleries).values({
    id: "g-s1",
    driveFolderId: "d-s1",
    slug: "s1",
    title: "S1",
    status: "published",
    clientId: "c-small",
  });
  await db.insert(schema.photos).values({
    id: "p-s1",
    galleryId: "g-s1",
    baseName: "s1",
    driveHighresId: "hr-s1",
    sort: 0,
  });
});

const slugs = (o: Out) => o.data.items!.map((i) => i.slug);

describe("T6.49 client page paging", () => {
  it("page size is the old cap, 60", () => {
    expect(CLIENT_PAGE_SIZE).toBe(60);
  });

  it("page 1 (bare URL) has the 60 newest and the page counters", async () => {
    const r = await load("/acme");
    expect(r.status).toBe(200);
    expect(slugs(r)).toEqual(Array.from({ length: 60 }, (_, i) => name(i)));
    expect(r.data.page).toBe(1);
    expect(r.data.pageCount).toBe(3);
  });

  it("page 2 and the last page continue the order without gaps or repeats", async () => {
    const p2 = await load("/acme?pagina=2");
    expect(slugs(p2)).toEqual(
      Array.from({ length: 60 }, (_, i) => name(60 + i)),
    );
    expect(p2.data.page).toBe(2);
    const p3 = await load("/acme?pagina=3");
    expect(slugs(p3)).toEqual(
      Array.from({ length: 10 }, (_, i) => name(120 + i)),
    );
    expect(p3.data.page).toBe(3);
    expect(p3.data.pageCount).toBe(3);
  });

  it("pagina=1 renders page 1 (same payload as the bare URL)", async () => {
    const a = await load("/acme");
    const b = await load("/acme?pagina=1");
    expect(b.status).toBe(200);
    expect(slugs(b)).toEqual(slugs(a));
    expect(b.data.page).toBe(1);
  });

  it("a well-formed page beyond the last is the same 404 as an unknown slug", async () => {
    const unknown = await load("/nope");
    for (const q of ["4", "999", "99999999999999999999999"]) {
      const r = await load(`/acme?pagina=${q}`);
      expect(r.status).toBe(404);
      expect(r.data).toEqual({ ...unknown.data });
      expect(r.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    }
  });

  it("garbage pagina is page 1", async () => {
    const first = slugs(await load("/acme"));
    for (const q of [
      "pagina=abc",
      "pagina=",
      "pagina=0",
      "pagina=-2",
      "pagina=2.5",
      "pagina=02",
      "pagina=%202",
      "pagina=2abc",
      "pagina=1e1",
      "pagina=0x2",
      "pagina=2&pagina=3",
      "pagina[]=2",
      "pagina=%E0%A4%A",
    ]) {
      const r = await load(`/acme?${q}`);
      expect(r.status, q).toBe(200);
      expect(slugs(r), q).toEqual(first);
      expect(r.data.page, q).toBe(1);
    }
  });

  it("parsePageParam: only a single canonical positive integer counts", () => {
    expect(parsePageParam([])).toBe(1);
    expect(parsePageParam(["1"])).toBe(1);
    expect(parsePageParam(["2"])).toBe(2);
    expect(parsePageParam(["12"])).toBe(12);
    for (const bad of ["", "0", "-1", "01", "1.5", "a", " 2", "2 ", "+2"])
      expect(parsePageParam([bad]), bad).toBe(1);
    expect(parsePageParam(["2", "3"])).toBe(1);
  });

  it("a single-page client has pageCount 1 and page 2 is a 404", async () => {
    const r = await load("/small");
    expect(r.data.pageCount).toBe(1);
    expect((await load("/small?pagina=2")).status).toBe(404);
  });

  it("PIN albums in the middle stay locked with no cover, date or hash on every page", async () => {
    const pages = await Promise.all(
      [1, 2, 3].map((n) => load(`/acme?pagina=${n}`)),
    );
    const all = pages.flatMap((p) => p.data.items!);
    expect(all).toHaveLength(TOTAL);
    const locked = all.filter((i) => i.locked);
    expect(locked.map((i) => i.slug)).toEqual(PIN_AT.map(name));
    for (const l of locked) {
      expect(l.cover).toBeNull();
      expect(l.eventDate).toBeNull();
    }
    const json = JSON.stringify(pages.map((p) => p.data));
    for (const bad of ["SECRET", "pinHash", "$pbkdf2", "hr-", "drive"])
      expect(json).not.toContain(bad);
    for (const p of pages) {
      expect(p.headers.get("Cache-Control")).toBe("private, no-store");
      expect(p.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
      expect(p.headers.get("X-Frame-Options")).toBe("DENY");
    }
  });

  it("draft, archived and expired albums are not counted in the pages", async () => {
    // the 10 newest
    await db
      .update(schema.galleries)
      .set({ status: "draft" })
      .where(
        inArray(
          schema.galleries.slug,
          Array.from({ length: 10 }, (_, i) => name(i)),
        ),
      );
    const r = await load("/acme");
    expect(slugs(r)[0]).toBe(name(10));
    expect(r.data.pageCount).toBe(2);
    expect(r.data.items).toHaveLength(60);
    const p2 = await load("/acme?pagina=2");
    expect(p2.data.items).toHaveLength(60);
    expect((await load("/acme?pagina=3")).status).toBe(404);
  });

  it("costs at most CLIENT_PAGE_D1_QUERIES queries on every page, binds <= 100", async () => {
    for (const q of ["", "?pagina=2", "?pagina=3", "?pagina=9", "?pagina=x"]) {
      const c = countingEnv(e);
      const binds: number[] = [];
      const DB = new Proxy(c.e.DB, {
        get(t, p) {
          const v = (t as never)[p];
          if (p !== "prepare")
            return typeof v === "function"
              ? (v as (...a: unknown[]) => unknown).bind(t)
              : v;
          return (s: string) => {
            const st = (v as (s: string) => D1PreparedStatement).call(t, s);
            return new Proxy(st, {
              get(st2, p2) {
                const f = (st2 as never)[p2];
                if (p2 !== "bind")
                  return typeof f === "function" ? f.bind(st2) : f;
                return (...a: unknown[]) => {
                  binds.push(a.length);
                  return (f as (...x: unknown[]) => unknown).apply(st2, a);
                };
              },
            });
          };
        },
      });
      await load(`/acme${q}`, { ...c.e, DB } as Env);
      expect(c.count(), q).toBeLessThanOrEqual(CLIENT_PAGE_D1_QUERIES + 1);
      if (q !== "?pagina=9")
        expect(c.count(), q).toBeLessThanOrEqual(CLIENT_PAGE_D1_QUERIES);
      expect(binds.length).toBeGreaterThan(0);
      for (const b of binds) expect(b).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    }
  });

  it("the studio home is unchanged: still capped at 60, no paging", async () => {
    await db.update(schema.galleries).set({ showOnHome: true });
    await db.update(schema.galleries).set({ pinHash: null });
    expect((await loadHome(e)).items.length).toBe(60);
  });
});
