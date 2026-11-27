import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../app/db";
import { createMockDrive } from "../app/lib/server/drive-mock";
import type { MockDrive } from "../app/lib/server/drive-mock";
import { D1_IN_CHUNK } from "../app/lib/server/d1-limits";
import { FOLDER_MIME } from "../app/lib/server/drive-types";
import type { MockEntry } from "../app/lib/server/fixtures";
import { runSync, SyncBudgetError } from "../app/lib/server/sync";

/**
 * T-refactor-runSync: pins the Cloudflare subrequest cap (900) and its
 * operation counting at the exact boundary, plus a few sync decisions whose
 * mutants were not killed by the phase characterization tests.
 *
 * Operation counts (one per D1/R2 call): lock 1, pending-deletes read 1,
 * token read 1 (+2 when a token is stored and Drive is asked), ignored
 * folders 1, galleries select 1, one per photo-row chunk, one per D1 batch,
 * token write 1, R2 delete calls and their pending-setting write.
 */
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const NOW = new Date("2026-03-01T12:00:00Z");
const LATER = new Date("2026-03-01T14:00:00Z");
const T = "2026-01-01T00:00:00.000Z";
const ROOT = "root";
const CAP = 900;
const BIG = 100_000; // Drive budget: irrelevant here

const folder = (id: string, name: string, parentId: string): MockEntry => ({
  id,
  name,
  mimeType: FOLDER_MIME,
  modifiedTime: T,
  parentId,
});
const jpg = (id: string, name: string, parentId: string): MockEntry => ({
  id,
  name,
  mimeType: "image/jpeg",
  modifiedTime: T,
  parentId,
  width: 2000,
  height: 1000,
});
const rootEntry = (): MockEntry => ({
  ...folder(ROOT, "root", ""),
  parentId: null,
});

const albumsDrive = (n: number): MockDrive =>
  createMockDrive({
    rootId: ROOT,
    entries: [
      rootEntry(),
      ...Array.from({ length: n }, (_, i) =>
        folder(`al${i}`, `Album ${String(i).padStart(4, "0")}`, ROOT),
      ),
    ],
  });

const library = (): MockDrive =>
  createMockDrive({
    rootId: ROOT,
    entries: [
      rootEntry(),
      folder("alpha", "2026-02-10 Alpha", ROOT),
      folder("a-hr", "high-res", "alpha"),
      jpg("a1", "A1.jpg", "a-hr"),
      jpg("a2", "A2.jpg", "a-hr"),
      folder("beta", "Beta", ROOT),
      folder("b-hr", "high-res", "beta"),
      jpg("b1", "B1.jpg", "b-hr"),
      folder("b-web", "web", "beta"),
      jpg("b1w", "B1.jpg", "b-web"),
    ],
  });

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await db.delete(schema.galleries);
  await db.delete(schema.ignoredFolders);
  await db.delete(schema.settings);
  for (const o of (await env.CACHE.list()).objects)
    await env.CACHE.delete(o.key);
  await db
    .insert(schema.settings)
    .values({ key: "drive_root_id", value: ROOT });
});

const setting = async (key: string) =>
  (
    await db.select().from(schema.settings).where(eq(schema.settings.key, key))
  )[0]?.value;
const putSetting = (key: string, value: string) =>
  db.insert(schema.settings).values({ key, value });
const galleries = () => db.select().from(schema.galleries);
const galleryByFolder = async (driveFolderId: string) =>
  (
    await db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.driveFolderId, driveFolderId))
  )[0];
const photosOf = (gid: string) =>
  db.select().from(schema.photos).where(eq(schema.photos.galleryId, gid));

/** Env whose CACHE.delete is scripted: `fail(callNo)` true -> rejects. */
function cacheEnv(fail: (call: number) => boolean, extra: Partial<Env> = {}) {
  const calls: string[][] = [];
  const CACHE = new Proxy(env.CACHE, {
    get: (t, k) =>
      k === "delete"
        ? async (keys: string | string[]) => {
            calls.push([keys].flat());
            if (fail(calls.length)) throw new Error("r2 down");
          }
        : (t as never)[k] instanceof Function
          ? ((t as never)[k] as (...a: unknown[]) => unknown).bind(t)
          : (t as never)[k],
  });
  return { ec: { ...e, ...extra, CACHE } as Env, calls };
}

/** Throws on the n-th D1 batch (earlier ones commit). */
function failingBatchEnv(failAt: number, CACHE: Env["CACHE"]): Env {
  let batches = 0;
  const DB = new Proxy(env.DB, {
    get(t, k) {
      const v = (t as never)[k];
      if (k === "batch")
        return (stmts: unknown[]) => {
          if (++batches === failAt) throw new Error("boom");
          return (v as (...x: unknown[]) => unknown).call(t, stmts);
        };
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  return { ...e, DB, CACHE } as Env;
}

/** A run that must hit the cap: SyncBudgetError, rows written so far stay, no token, no lock. */
async function expectCapExceeded(
  p: Promise<unknown>,
  writtenAlbums: number,
  tokenBefore?: string,
) {
  await expect(p).rejects.toBeInstanceOf(SyncBudgetError);
  expect(await galleries()).toHaveLength(writtenAlbums);
  expect(await setting("drive_changes_token")).toBe(tokenBefore);
  expect(await setting("sync_lock")).toBeUndefined();
}

describe("T-refactor-runSync: 900-subrequest cap, exact operation counting", () => {
  // fresh run: lock 1 + pending 1 + token 1 + ignored 1 + select 1 + client slugs 1 + N batches + token write 1
  const FRESH_FIXED = 7;
  const freshMax = CAP - FRESH_FIXED;

  it("fresh library: the last operation at exactly 900 succeeds", async () => {
    const r = await runSync(e, {
      drive: albumsDrive(freshMax),
      budget: BIG,
      now: NOW,
    });
    expect(r.galleries.created).toBe(freshMax);
    expect(await setting("drive_changes_token")).toBe("1");
  }, 120_000);

  it("fresh library: the 901st operation (the token write) throws after all galleries are written", async () => {
    await expectCapExceeded(
      runSync(e, {
        drive: albumsDrive(freshMax + 1),
        budget: BIG,
        now: NOW,
      }),
      freshMax + 1,
    );
  }, 120_000);

  // second run with a stored token and a Drive change, every album changed:
  // lock 1 + pending 1 + token 1 +2 (Drive asked) + ignored 1 + select 1 + client slugs 1
  // + ceil(M/90) photo-row chunks + M batches + token write 1
  const changedOps = (m: number) => 9 + Math.ceil(m / D1_IN_CHUNK) + m;
  const changedMax = (() => {
    let m = 1;
    while (changedOps(m + 1) <= CAP) m++;
    return m;
  })();

  async function changedRun(m: number) {
    const d = albumsDrive(m);
    await runSync(e, { drive: d, budget: BIG, now: NOW });
    const token = await setting("drive_changes_token");
    for (let i = 0; i < m; i++) d.renameFile(`al${i}`, `Album ${i} renamed`);
    return { run: runSync(e, { drive: d, budget: BIG, now: LATER }), token };
  }

  it("changed library (stored token, chunked photo-row reads): exactly 900 operations succeed", async () => {
    expect(changedOps(changedMax)).toBe(CAP);
    const { run, token } = await changedRun(changedMax);
    const r = await run;
    expect(r.galleries.updated).toBe(changedMax);
    expect(await setting("drive_changes_token")).not.toBe(token);
  }, 180_000);

  it("changed library: one operation more (901) throws at the token write; the updates stay", async () => {
    expect(changedOps(changedMax + 1)).toBe(CAP + 1);
    const { run, token } = await changedRun(changedMax + 1);
    await expectCapExceeded(run, changedMax + 1, token);
    const g = await galleryByFolder("al0");
    expect(g.lastSyncedAt).toBe("2026-03-01T14:00:00Z");
  }, 180_000);

  // pending ids from a previous run: + 1 R2 delete call + 1 pending-setting drop
  const pendingMax = CAP - 9;

  it("pending R2 flush at start counts its delete call and the setting drop: 900 passes", async () => {
    await putSetting("r2_pending_deletes", JSON.stringify(["p1"]));
    const r = await runSync(e, {
      drive: albumsDrive(pendingMax),
      budget: BIG,
      now: NOW,
    });
    expect(r.galleries.created).toBe(pendingMax);
    expect(await setting("r2_pending_deletes")).toBeUndefined();
  }, 120_000);

  it("pending R2 flush at start: the 901st operation throws", async () => {
    await putSetting("r2_pending_deletes", JSON.stringify(["p1"]));
    await expectCapExceeded(
      runSync(e, {
        drive: albumsDrive(pendingMax + 1),
        budget: BIG,
        now: NOW,
      }),
      pendingMax + 1,
    );
  }, 120_000);
});

describe("T-refactor-runSync: issue order with highres_empty", () => {
  it("highres_empty is sorted in among stray_file / not_jpeg / unknown_folder / missing_highres", async () => {
    const d = library();
    await runSync(e, { drive: d, budget: BIG, now: NOW });
    d.removeFile("b1");
    d.addFile("beta", {
      id: "stray",
      name: "notes.txt",
      mimeType: "text/plain",
    });
    d.addFile("beta", { id: "misc", name: "Misc", mimeType: FOLDER_MIME });
    d.addFile("b-web", {
      id: "doc",
      name: "doc.pdf",
      mimeType: "application/pdf",
    });
    const r = await runSync(e, {
      drive: d,
      force: true,
      budget: BIG,
      now: LATER,
    });
    const g = await galleryByFolder("beta");
    expect(JSON.parse(g.syncIssuesJson!)).toEqual([
      { type: "highres_empty", set: null, name: "high-res" },
      { type: "missing_highres", set: "Highlights", name: "B1" },
      { type: "not_jpeg", set: "Highlights", name: "doc.pdf" },
      { type: "stray_file", set: null, name: "notes.txt" },
      { type: "unknown_folder", set: null, name: "Misc" },
    ]);
    expect(r.issues).toBeGreaterThanOrEqual(5);
  });
});

describe("T-refactor-runSync: sync-archived restore rules", () => {
  async function seedAndArchiveFlag(
    patch: Partial<typeof schema.galleries.$inferInsert>,
  ) {
    const d = library();
    await runSync(e, { drive: d, budget: BIG, now: NOW });
    const g = await galleryByFolder("beta");
    await db
      .update(schema.galleries)
      .set(patch)
      .where(eq(schema.galleries.id, g.id));
    await runSync(e, { drive: d, force: true, budget: BIG, now: LATER });
    return galleryByFolder("beta");
  }

  it("an admin-unarchived gallery that sync had archived keeps its status and drops the flag even when nothing else changed", async () => {
    const g = await seedAndArchiveFlag({
      status: "published",
      archivedBySync: true,
      archivedPrevStatus: "draft",
    });
    expect(g.status).toBe("published"); // not reset to the remembered "draft"
    expect(g.archivedBySync).toBe(false); // the update ran despite no other change
    expect(g.archivedPrevStatus).toBeNull();
  });

  it("a sync-archived gallery without a remembered status comes back as draft", async () => {
    const g = await seedAndArchiveFlag({
      status: "archived",
      archivedBySync: true,
      archivedPrevStatus: null,
    });
    expect(g.status).toBe("draft");
    expect(g.archivedBySync).toBe(false);
  });
});

describe("T-refactor-runSync: empty root guard", () => {
  it("an empty root with NO galleries is not 'empty_root': it syncs normally and stores the token", async () => {
    const empty = createMockDrive({ rootId: ROOT, entries: [rootEntry()] });
    const r = await runSync(e, { drive: empty, budget: BIG, now: NOW });
    expect(r.skipped).toBeUndefined();
    expect(await setting("drive_changes_token")).toBe("1");
  });
});

describe("T-refactor-runSync: pending R2 delete bookkeeping", () => {
  /** Syncs the library, removes A2 and marks it, returns the drive and A2's photo id. */
  async function withGoneA2() {
    const d = library();
    await runSync(e, { drive: d, budget: BIG, now: NOW });
    const gid = (await galleryByFolder("alpha")).id;
    const a2 = (await photosOf(gid)).find((p) => p.baseName === "A2")!;
    d.removeFile("a2");
    await runSync(e, { drive: d, force: true, budget: BIG, now: NOW });
    // beta changes too, so the next run has a 2nd batch to fail on
    d.addFile("beta", { id: "stray", name: "x.txt", mimeType: "text/plain" });
    return { d, id: a2.id };
  }

  it("an id already pending is not persisted twice when its row is deleted (same batch as the delete)", async () => {
    const { d, id } = await withGoneA2();
    await putSetting("r2_pending_deletes", JSON.stringify([id]));
    // R2 down: the start flush fails and keeps [id]; the 1st batch (alpha) commits, the 2nd throws,
    // so the value the batch wrote is what stays in D1.
    const { ec } = cacheEnv(() => true);
    await expect(
      runSync(failingBatchEnv(2, ec.CACHE), {
        drive: d,
        force: true,
        budget: BIG,
        now: LATER,
      }),
    ).rejects.toThrow("boom");
    expect(JSON.parse((await setting("r2_pending_deletes"))!)).toEqual([id]);
  });

  it("T6.55: with a full pending list and R2 down the removal is deferred (row kept, nothing lost, sync goes on)", async () => {
    const { d, id } = await withGoneA2();
    const seeds = Array.from({ length: 2000 }, (_, i) => `s${i}`);
    await putSetting("r2_pending_deletes", JSON.stringify(seeds));
    const { ec } = cacheEnv(() => true);
    const r = await runSync(ec, {
      drive: d,
      force: true,
      budget: BIG,
      now: LATER,
    });
    expect(r.photos.removed).toBe(0);
    // the removed photo's row is still there (its keys are recomputed from it next run) and the list is untouched
    const gid = (await galleryByFolder("alpha")).id;
    expect((await photosOf(gid)).map((p) => p.id)).toContain(id);
    expect(JSON.parse((await setting("r2_pending_deletes"))!)).toEqual(seeds);
    // once R2 is back the same run finishes everything
    const back = cacheEnv(() => false);
    await runSync(back.ec, { drive: d, force: true, budget: BIG, now: LATER });
    expect((await photosOf(gid)).map((p) => p.id)).not.toContain(id);
    expect(await setting("r2_pending_deletes")).toBeUndefined();
  });

  it("duplicate pending ids are deleted once (3 keys, not 6)", async () => {
    await putSetting("r2_pending_deletes", JSON.stringify(["p1", "p1"]));
    const { ec, calls } = cacheEnv(() => false);
    await runSync(ec, { drive: library(), budget: BIG, now: NOW });
    expect(calls[0]).toEqual(["p1/thumb", "p1/view-sm", "p1/view-lg"]);
  });

  it("after a partial failure only the ids not yet deleted stay pending", async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `q${i}`);
    await putSetting("r2_pending_deletes", JSON.stringify(ids));
    // 333 ids per call: call 1 succeeds, every later call fails
    const { ec, calls } = cacheEnv((n) => n >= 2);
    await runSync(ec, { drive: library(), budget: BIG, now: NOW });
    expect(calls[0]).toHaveLength(333 * 3);
    expect(JSON.parse((await setting("r2_pending_deletes"))!)).toEqual(
      ids.slice(333),
    );
  });
});
