import { env } from "cloudflare:workers";
import { RouterContextProvider } from "react-router";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { clientEditData } from "../app/lib/server/admin-clients";
import { hashPin } from "../app/lib/server/crypto";
import { executionContext } from "../app/lib/server/context";
import {
  CLIENT_PAGE_D1_QUERIES,
  D1_MAX_BOUND_PARAMS,
} from "../app/lib/server/d1-limits";
import { galleryLoader } from "../app/lib/server/gallery-route";
import {
  CLIENT_CANDIDATE_CAP,
  CLIENT_PAGE_SIZE,
  loadClientTiles,
} from "../app/lib/server/home";
import { capturingBindsEnv } from "./support/binds";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv } from "./support/warm";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(e);
const PAST = "2000-01-01T00:00:00.000Z";

type Opts = { expired?: boolean; photo?: boolean; pin?: string };
/** Album `j` (0 = newest) of client c1; listable unless `o` says otherwise. */
async function seed(
  from: number,
  to: number,
  o: (j: number) => Opts = () => ({}),
) {
  for (let i = from; i < to; i += 40) {
    const stmts = [];
    for (let j = i; j < Math.min(to, i + 40); j++) {
      const opt = o(j);
      stmts.push(
        db.insert(schema.galleries).values({
          id: `g${j}`,
          driveFolderId: `d${j}`,
          slug: `x${String(j).padStart(4, "0")}`,
          title: `T${j}`,
          status: "published",
          clientId: "c1",
          expiresAt: opt.expired ? PAST : null,
          pinHash: opt.pin ?? null,
          eventDate: new Date(Date.UTC(2026, 0, 1) - j * 86_400_000)
            .toISOString()
            .slice(0, 10),
        }),
      );
      if (opt.photo !== false)
        stmts.push(
          db.insert(schema.photos).values({
            id: `p${j}`,
            galleryId: `g${j}`,
            baseName: `b${j}`,
            driveHighresId: `hr${j}`,
            sort: 0,
          }),
        );
    }
    await db.batch(stmts as never);
  }
}

const slugs = async (page: number) =>
  ((await loadClientTiles(e, "acme", page))?.tiles ?? []).map((t) => t.slug);
const adminStatus = async () =>
  (await clientEditData(new Request("http://localhost/x"), e, "c1")).publicPage;

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("photos", "galleries", "clients");
  await db.insert(schema.clients).values({ id: "c1", slug: "acme", name: "A" });
});

describe("T6.49 cap counts only listable albums", () => {
  it("1001 listable: newest 1000 listed, 17 pages, last has 40, no duplicates; admin 1000+", async () => {
    await seed(0, CLIENT_CANDIDATE_CAP + 1);
    const first = await loadClientTiles(e, "acme");
    expect(first!.pageCount).toBe(17);
    const all: string[] = [];
    for (let p = 1; p <= 17; p++) all.push(...(await slugs(p)));
    expect(all.length).toBe(1000);
    expect(new Set(all).size).toBe(1000);
    expect(all[0]).toBe("x0000");
    expect(all.at(-1)).toBe("x0999");
    expect(all).not.toContain("x1000");
    expect((await slugs(17)).length).toBe(40);
    expect(await slugs(18)).toEqual([]);
    expect(await adminStatus()).toEqual({
      visible: 1000,
      capped: true,
      reason: null,
    });
  }, 60_000);

  it("exactly 1000 listable is not capped for the admin", async () => {
    await seed(0, CLIENT_CANDIDATE_CAP);
    expect(await adminStatus()).toEqual({ visible: 1000, reason: null });
    expect((await loadClientTiles(e, "acme"))!.pageCount).toBe(17);
  }, 60_000);

  it("1000 newer expired + 5 cover-less + PIN albums do not push older valid ones out; admin agrees", async () => {
    const pin = await hashPin("1234");
    const N = 1010;
    await seed(0, N, (j) =>
      j < 1000
        ? { expired: true }
        : j < 1005
          ? { photo: false }
          : j === 1005
            ? { pin }
            : {},
    );
    expect((await slugs(1)).length).toBe(5);
    expect((await loadClientTiles(e, "acme"))!.pageCount).toBe(1);
    expect(await adminStatus()).toEqual({ visible: 5, reason: null });
  }, 60_000);

  it("page boundary: 60 albums is one page, 61 is two", async () => {
    await seed(0, CLIENT_PAGE_SIZE);
    expect((await loadClientTiles(e, "acme"))!.pageCount).toBe(1);
    expect(await slugs(2)).toEqual([]);
    await seed(CLIENT_PAGE_SIZE, CLIENT_PAGE_SIZE + 1);
    expect((await loadClientTiles(e, "acme"))!.pageCount).toBe(2);
    expect(await slugs(2)).toEqual(["x0060"]);
  });

  it("queries <= 3, binds <= 100, and PIN ids are never bound in the covers query", async () => {
    const pin = await hashPin("1234");
    await seed(0, 130, (j) => (j % 7 === 0 ? { pin } : {}));
    for (const page of [1, 2, 3]) {
      const c = countingEnv(e);
      const spy = capturingBindsEnv(c.e);
      const out = await loadClientTiles(spy.e, "acme", page);
      expect(out!.tiles.length).toBeGreaterThan(0);
      expect(c.count()).toBeLessThanOrEqual(CLIENT_PAGE_D1_QUERIES);
      const flat = spy.binds.flat().map(String);
      for (const b of spy.binds)
        expect(b.length).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
      for (let j = 0; j < 130; j += 7) {
        expect(flat).not.toContain(`p${j}`);
        expect(flat).not.toContain(`g${j}`);
      }
      // covers of the page's unlocked tiles only
      const covers = spy.binds.find((b) =>
        b.some((x) => /^p\d+$/.test(String(x))),
      );
      expect(covers!.length).toBeLessThanOrEqual(CLIENT_PAGE_SIZE);
    }
  });

  it("the public loader agrees (200 and a tile) when the only valid album is older than 1000 junk ones", async () => {
    await seed(0, 1001, (j) => (j < 1000 ? { photo: false } : {}));
    const c = new RouterContextProvider();
    c.set(executionContext, {
      waitUntil() {},
      passThroughException() {},
    } as never);
    const r = (await galleryLoader(
      {
        request: new Request("https://gallery.381studios.ar/acme", {
          headers: { "Sec-Fetch-Mode": "navigate" },
        }),
        context: c,
      } as never,
      { album: "acme" },
      e,
    )) as { data: { items?: unknown[] }; init: ResponseInit };
    expect(r.init?.status ?? 200).toBe(200);
    expect(r.data.items).toHaveLength(1);
  }, 60_000);
});
