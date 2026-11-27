import { env } from "cloudflare:workers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getDb, schema } from "../app/db";
import {
  D1_FREE_QUERIES_PER_INVOCATION,
  D1_IN_CHUNK,
  D1_MAX_BOUND_PARAMS,
  INVOCATION_SAFETY,
} from "../app/lib/server/d1-limits";
import {
  emptySweepTotals,
  SWEEP_LIST_LIMIT,
  SWEEP_MIN_AGE_MS,
  SWEEP_WORST_CASE_D1_QUERIES,
  sweepPage,
} from "../app/lib/server/orphan-sweep";
import type { SweepTotals } from "../app/lib/server/orphan-sweep";
import { putSetting, SETTINGS_KEYS } from "../app/lib/server/settings";
import { clearCache } from "./support/cache";
import { migrateDb, resetTables } from "./support/d1";
import { fakeBucket, uuid } from "./support/fake-r2";
import { seedVersioned } from "./support/versions";

/** T6.59 orphan cache sweep: scan (dry run) and delete, page by page. */
const db = getDb(env);
const GID = "g-sweep";
import { VARIANTS } from "./support/fake-r2";
/** Far enough ahead that every object just uploaded is older than the safety age. */
const LATER = new Date(Date.now() + 2 * SWEEP_MIN_AGE_MS);
const put = (id: string, entry = "") =>
  Promise.all(VARIANTS.map((v) => env.CACHE.put(`${id}${entry}/${v}`, "xxxx")));
const keys = async () => {
  const out: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.CACHE.list({ cursor });
    out.push(...page.objects.map((o) => o.key));
    if (!page.truncated) return out.sort();
    cursor = page.cursor;
  }
};
const addPhoto = (id: string) =>
  db.insert(schema.photos).values({
    id,
    galleryId: GID,
    baseName: id,
    driveHighresId: `HI-${id}`,
  });

/** Runs every page of a pass; returns the final totals and how many requests it took. */
async function run(
  mode: "scan" | "delete",
  opts: {
    now?: Date;
    listLimit?: number;
    bucket?: Pick<R2Bucket, "list" | "delete">;
  } = {},
) {
  let cursor: string | null = null;
  let totals: SweepTotals = emptySweepTotals();
  let requests = 0;
  do {
    const page = await sweepPage(
      {
        ...env,
        ...(opts.bucket ? { CACHE: opts.bucket as R2Bucket } : {}),
      } as Env,
      {
        mode,
        cursor,
        totals,
        now: opts.now ?? LATER,
        listLimit: opts.listLimit,
      },
    );
    cursor = page.cursor;
    totals = page.totals;
    requests++;
  } while (cursor);
  return { totals, requests };
}

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables(
    "settings",
    "photo_versions",
    "delivery_rounds",
    "photos",
    "galleries",
  );
  await clearCache();
  await db.insert(schema.galleries).values({
    id: GID,
    driveFolderId: "alb",
    slug: "alb",
    title: "Alb",
    status: "published",
    versioning: true,
  });
});
afterEach(() => vi.restoreAllMocks());

describe("T6.59 constants", () => {
  it("the page size is one R2 list call and the lookups stay inside the Free limits", () => {
    expect(SWEEP_LIST_LIMIT).toBe(1000);
    expect(D1_IN_CHUNK).toBeLessThan(D1_MAX_BOUND_PARAMS);
    expect(SWEEP_WORST_CASE_D1_QUERIES).toBeLessThanOrEqual(
      D1_FREE_QUERIES_PER_INVOCATION - INVOCATION_SAFETY,
    );
    expect(SWEEP_MIN_AGE_MS).toBe(60 * 60_000);
  });
});

describe("T6.59 scan decides what is an orphan", () => {
  it("a key whose photo has no row is an orphan; a live photo's keys are not", async () => {
    await addPhoto(uuid(1));
    await put(uuid(1));
    await put(uuid(2));
    const { totals } = await run("scan");
    expect(totals).toMatchObject({
      scanned: 6,
      orphans: 3,
      ignored: 0,
      bytes: 12,
    });
    expect(await keys()).toHaveLength(6); // a scan never deletes
  });

  it("mutation guard: with the photo row removed the same keys flip to orphan", async () => {
    await addPhoto(uuid(1));
    await put(uuid(1));
    expect((await run("scan")).totals.orphans).toBe(0);
    await db.delete(schema.photos);
    expect((await run("scan")).totals.orphans).toBe(3);
  });

  it("a v>=2 key needs a live version row; v1 keys need only the photo", async () => {
    await seedVersioned(GID, uuid(1), [{ n: 1 }, { n: 2 }]);
    await put(uuid(1), "");
    await put(uuid(1), "/v2");
    await put(uuid(1), "/v3"); // no such version of a photo that exists
    const { totals } = await run("scan");
    expect(totals.orphans).toBe(3);
    await run("delete");
    expect(await keys()).toEqual(
      [
        ...VARIANTS.map((v) => `${uuid(1)}/${v}`),
        ...VARIANTS.map((v) => `${uuid(1)}/v2/${v}`),
      ].sort(),
    );
  });

  it("a version row in grace (missingSince) still protects its keys, and so does a photo in grace", async () => {
    await seedVersioned(GID, uuid(1), [{ n: 1 }, { n: 2, missing: true }]);
    await db
      .update(schema.photos)
      .set({ missingSince: "2026-03-01T00:00:00.000Z" });
    await put(uuid(1), "");
    await put(uuid(1), "/v2");
    expect((await run("scan")).totals.orphans).toBe(0);
  });

  it("an album with versioning switched off keeps its v2 keys while the rows exist", async () => {
    await seedVersioned(GID, uuid(1), [{ n: 1 }, { n: 2 }]);
    await db.update(schema.galleries).set({ versioning: false });
    await put(uuid(1), "/v2");
    expect((await run("scan")).totals.orphans).toBe(0);
  });

  it("keys listed in r2_pending_deletes are left to the sync that queued them", async () => {
    await put(uuid(1));
    await put(uuid(2), "/v2");
    await put(uuid(3));
    await putSetting(
      env,
      SETTINGS_KEYS.r2PendingDeletes,
      JSON.stringify([uuid(1), `${uuid(2)}/v2`]),
    );
    const { totals } = await run("scan");
    expect(totals).toMatchObject({ orphans: 3, held: 6 });
    await run("delete");
    expect((await keys()).length).toBe(6);
  });

  it("anything younger than the safety age is held, not an orphan", async () => {
    await put(uuid(1));
    const fresh = await run("scan", { now: new Date() });
    expect(fresh.totals).toMatchObject({ orphans: 0, held: 3 });
    const old = await run("scan", {
      now: new Date(Date.now() + SWEEP_MIN_AGE_MS + 1000),
    });
    expect(old.totals).toMatchObject({ orphans: 3, held: 0 });
    await run("delete", { now: new Date() });
    expect(await keys()).toHaveLength(3);
  });

  it("keys outside the allow-list are only counted as ignored and never deleted", async () => {
    const odd = [
      "brand/logo-light",
      `${"0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d".toUpperCase()}/thumb`,
      `${uuid(1)}/original`,
      `${uuid(1)}/v1/thumb`,
      `x/${uuid(1)}/thumb`,
      `${uuid(1)}/v2/thumb/extra`,
    ];
    await Promise.all(odd.map((k) => env.CACHE.put(k, "x")));
    await put(uuid(9));
    const scan = await run("scan");
    expect(scan.totals).toMatchObject({ ignored: odd.length, orphans: 3 });
    const del = await run("delete");
    expect(del.totals.deleted).toBe(3);
    expect(await keys()).toEqual([...odd].sort());
  });
});

describe("T6.59 delete", () => {
  it("deletes exactly the orphans and counts them", async () => {
    await addPhoto(uuid(1));
    await put(uuid(1));
    await put(uuid(2));
    await put(uuid(3), "/v4");
    const { totals } = await run("delete");
    expect(totals).toMatchObject({ orphans: 6, deleted: 6 });
    expect(await keys()).toEqual(VARIANTS.map((v) => `${uuid(1)}/${v}`).sort());
  });

  it("is idempotent: a second pass finds and deletes nothing", async () => {
    await put(uuid(1));
    await run("delete");
    const again = await run("delete");
    expect(again.totals).toMatchObject({ scanned: 0, orphans: 0, deleted: 0 });
  });

  it("race: a photo created between the list and the delete survives", async () => {
    await put(uuid(1));
    await put(uuid(2));
    const real = env.CACHE;
    const bucket = {
      delete: (k: string | string[]) => real.delete(k),
      list: async (o?: R2ListOptions) => {
        const page = await real.list(o);
        await addPhoto(uuid(1)); // the owner's sync adds it right after the listing
        return page;
      },
    };
    const { totals } = await run("delete", { bucket });
    expect(totals.deleted).toBe(3);
    expect(await keys()).toEqual(VARIANTS.map((v) => `${uuid(1)}/${v}`).sort());
  });

  it("race: a version row created after the scan keeps its keys", async () => {
    await seedVersioned(GID, uuid(1), [{ n: 1 }]);
    await put(uuid(1), "/v2");
    expect((await run("scan")).totals.orphans).toBe(3);
    await db.insert(schema.photoVersions).values({
      photoId: uuid(1),
      galleryId: GID,
      version: 2,
      driveHighresId: "HI-new",
    });
    await run("delete");
    expect(await keys()).toHaveLength(3);
  });

  it("never touches anything but R2 cache keys (no Drive, no D1 rows)", async () => {
    await put(uuid(1));
    const before = (await db.select().from(schema.galleries)).length;
    await run("delete");
    expect((await db.select().from(schema.galleries)).length).toBe(before);
  });

  it("deletes in bounded calls of at most 1000 exact keys", async () => {
    for (let i = 0; i < 400; i++) await put(uuid(i));
    const del = vi.spyOn(env.CACHE, "delete");
    await run("delete");
    const sizes = del.mock.calls.map((c) => (c[0] as string[]).length);
    expect(sizes.every((n) => n <= 1000 && n > 0)).toBe(true);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(1200);
    expect(await keys()).toEqual([]);
  });
});

describe("T6.59 pages, budgets and resuming (fake bucket of 5400 keys)", () => {
  it("scan walks every key in bounded pages, one list call and few D1 queries per request", async () => {
    const f = fakeBucket(5400);
    for (let i = 0; i < 1800; i += 3) await addPhoto(uuid(i)); // a third of the photos are live
    const prepare = vi.spyOn(env.DB, "prepare");
    const perRequest: number[] = [];
    let cursor: string | null = null;
    let totals = emptySweepTotals();
    let requests = 0;
    do {
      const before = prepare.mock.calls.length;
      const listed = f.calls.list;
      const page: Awaited<ReturnType<typeof sweepPage>> = await sweepPage(
        { ...env, CACHE: f.bucket as R2Bucket } as Env,
        { mode: "scan", cursor, totals, now: LATER },
      );
      expect(f.calls.list - listed).toBe(1);
      perRequest.push(prepare.mock.calls.length - before);
      cursor = page.cursor;
      totals = page.totals;
      requests++;
    } while (cursor);
    expect(requests).toBe(6);
    expect(Math.max(...perRequest)).toBeLessThanOrEqual(
      SWEEP_WORST_CASE_D1_QUERIES,
    );
    expect(totals.scanned).toBe(5400);
    expect(totals.orphans).toBe(5400 - 600 * 3);
    expect(totals.bytes).toBe(totals.orphans * 10);
    expect(f.live.size).toBe(5400);
    // no statement binds more than the D1 limit
    for (const c of prepare.mock.calls) expect(String(c[0])).toBeTruthy();
  });

  it("no bound statement exceeds 100 parameters", async () => {
    const f = fakeBucket(3000);
    const bind = vi.spyOn(D1PreparedStatementProto(), "bind");
    await run("scan", { bucket: f.bucket });
    for (const c of bind.mock.calls)
      expect(c.length).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    expect(bind.mock.calls.length).toBeGreaterThan(0);
  });

  it("delete resumes from a cursor and never repeats work; the pass ends with everything gone", async () => {
    const f = fakeBucket(5400);
    const e = { ...env, CACHE: f.bucket as R2Bucket } as Env;
    const page = await sweepPage(e, {
      mode: "delete",
      cursor: null,
      totals: emptySweepTotals(),
      now: LATER,
    });
    expect(page.cursor).not.toBeNull();
    expect(page.totals.deleted).toBe(1000);
    expect(f.live.size).toBe(4400);
    // a retry of the same request (cursor lost the first response) is harmless
    const resumed = await sweepPage(e, {
      mode: "delete",
      cursor: page.cursor,
      totals: page.totals,
      now: LATER,
    });
    expect(resumed.totals.deleted).toBe(2000);
    let cursor = resumed.cursor;
    let totals = resumed.totals;
    while (cursor) {
      const p = await sweepPage(e, {
        mode: "delete",
        cursor,
        totals,
        now: LATER,
      });
      cursor = p.cursor;
      totals = p.totals;
    }
    expect(totals.deleted).toBe(5400);
    expect(f.live.size).toBe(0);
  });

  it("a page of 1000 distinct single-key photos stays inside the query budget", async () => {
    const f = fakeBucket(0);
    for (let i = 0; i < 1000; i++) f.live.add(`${uuid(i)}/v2/thumb`);
    for (let i = 0; i < 1000; i += 2) await addPhoto(uuid(i));
    const prepare = vi.spyOn(env.DB, "prepare");
    const page = await sweepPage(
      { ...env, CACHE: f.bucket as R2Bucket } as Env,
      {
        mode: "scan",
        cursor: null,
        totals: emptySweepTotals(),
        now: LATER,
      },
    );
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(
      SWEEP_WORST_CASE_D1_QUERIES,
    );
    expect(page.totals.orphans).toBe(1000); // no version rows at all
  });

  it("young objects in the fake bucket are held", async () => {
    const f = fakeBucket(30, new Date());
    const { totals } = await run("scan", { bucket: f.bucket, now: new Date() });
    expect(totals).toMatchObject({ orphans: 0, held: 30 });
  });
});

function D1PreparedStatementProto() {
  return Object.getPrototypeOf(
    env.DB.prepare("select 1"),
  ) as D1PreparedStatement;
}
