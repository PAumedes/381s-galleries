import { clearCache } from "./support/cache";
import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, nowIso, schema } from "../app/db";
import { createMockDrive } from "../app/lib/server/drive-mock";
import type { MockDrive } from "../app/lib/server/drive-mock";
import { buildFixtures } from "../app/lib/server/fixtures";
import { DriveError } from "../app/lib/server/drive-types";
import type { DriveClient } from "../app/lib/server/drive-types";
import { OPEN_WARM_BUDGET } from "../app/lib/server/gallery-warm";
import { putSetting, SETTINGS_KEYS } from "../app/lib/server/settings";
import { runSync } from "../app/lib/server/sync";
import {
  runWarmCron,
  scheduleWarmAfterSync,
  warmPendingGalleries,
} from "../app/lib/server/warm-after-sync";
import type { SyncResult } from "../app/lib/server/sync";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "google" } as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const G = "gggggggg-0000-0000-0000-0000000000a1";
const PENDING = SETTINGS_KEYS.warmPendingPrefix;

beforeAll(async () => {
  await migrateDb();
});

function fakeDrive(fail = new Set<string>()) {
  let subs = 0;
  const calls: string[] = [];
  const drive = {
    subrequests: () => subs,
    async streamFile(id: string) {
      calls.push(id);
      subs += 1;
      if (fail.has(id)) throw new DriveError(500, "x", "detail " + id);
      return new Response(JPEG.slice(), {
        headers: { "Content-Length": String(JPEG.length) },
      });
    },
  } as unknown as DriveClient;
  return { drive, calls };
}

async function gallery(over: Record<string, unknown> = {}, id = G) {
  await db.insert(schema.galleries).values({
    id,
    driveFolderId: "folder-" + id,
    slug: "s-" + id.slice(-3),
    title: "T",
    status: "published",
    ...over,
  });
}
const pid = (i: number) => `p${String(i).padStart(3, "0")}`;
const versions = (n = "1") =>
  JSON.stringify({
    highres: `2026-01-01T00:00:0${n}Z`,
    web: `2026-01-01T00:00:0${n}Z`,
    thumb: `2026-01-01T00:00:0${n}Z`,
    wm: `2026-01-01T00:00:0${n}Z`,
    thumbWm: `2026-01-01T00:00:0${n}Z`,
  });
async function photos(n: number, galleryId = G) {
  for (let i = 0; i < n; i++) {
    const id = galleryId.slice(-3) + pid(i);
    await db.insert(schema.photos).values({
      id,
      galleryId,
      baseName: id,
      driveHighresId: `HI-${id}`,
      driveWebId: `WEB-${id}`,
      driveThumbId: `TH-${id}`,
      driveWmId: `WM-${id}`,
      driveThumbWmId: `TWM-${id}`,
      variantVersions: versions(),
      width: 300,
      height: 200,
    });
  }
}
const mark = (id = G) => putSetting(e, PENDING + id, nowIso());
const marker = async (id = G) =>
  (
    await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, PENDING + id))
  )[0];
const cached = async (id: string, v: string) =>
  (await env.CACHE.head(`${id}/${v}`)) !== null;
const allCached = async (id: string, vs: string[]) => {
  for (const v of vs) if (!(await cached(id, v))) return false;
  return true;
};

beforeEach(async () => {
  await db.delete(schema.galleries);
  await resetTables("settings", "rate_limits");
  await clearCache();
});

describe("T6.39 sync marks the galleries it changed", () => {
  const mockEnv = { ...env, DRIVE_MODE: "mock" } as Env;
  let drive: MockDrive;
  const root = buildFixtures().rootId;
  beforeEach(async () => {
    drive = createMockDrive();
    await db
      .insert(schema.settings)
      .values({ key: "drive_root_id", value: root });
    await runSync(mockEnv, { drive });
  });
  const markers = () =>
    db
      .select()
      .from(schema.settings)
      .then((r) => r.filter((s) => s.key.startsWith(PENDING)));

  it("marks every gallery that received photos in the first sync", async () => {
    const gs = await db.select().from(schema.galleries);
    const ms = (await markers()).map((m) => m.key);
    expect(gs.length).toBeGreaterThan(0);
    for (const g of gs) expect(ms).toContain(PENDING + g.id);
  });

  it("a forced no-change sync marks nothing new", async () => {
    for (const m of await markers())
      await db.delete(schema.settings).where(eq(schema.settings.key, m.key));
    await runSync(mockEnv, { drive, force: true });
    expect(await markers()).toHaveLength(0);
  });

  it("an added photo marks only its gallery; a changed variant too", async () => {
    for (const m of await markers())
      await db.delete(schema.settings).where(eq(schema.settings.key, m.key));
    const [g] = await db.select().from(schema.galleries);
    const [p] = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.galleryId, g.id));
    const meta = await drive.getMeta(p.driveThumbId!);
    drive.renameFile(meta.id, meta.name.replace(/\.jpg$/i, ".jpeg"));
    const r = await runSync(mockEnv, { drive });
    expect(r.photos.updated).toBe(1);
    expect((await markers()).map((m) => m.key)).toEqual([PENDING + g.id]);
  });
});

describe("T6.39 warmPendingGalleries", () => {
  it("a gallery larger than one invocation continues on the next runs, then the marker clears", async () => {
    await gallery();
    await photos(30);
    await mark();
    const first = fakeDrive();
    const r = await warmPendingGalleries(e, first.drive);
    expect(first.calls.length).toBeGreaterThan(0);
    expect(first.drive.subrequests()).toBeLessThanOrEqual(OPEN_WARM_BUDGET);
    expect(r.stopped).toBe("budget");
    expect(await marker()).toBeDefined(); // not finished: stays pending
    const all = [...first.calls];
    for (let i = 0; i < 10 && (await marker()); i++) {
      await resetTables("rate_limits");
      const n = fakeDrive();
      await warmPendingGalleries(e, n.drive);
      all.push(...n.calls);
    }
    expect(await marker()).toBeUndefined();
    expect(new Set(all).size).toBe(all.length); // nothing fetched twice
    for (let i = 0; i < 30; i++)
      expect(
        await allCached(G.slice(-3) + pid(i), ["thumb", "view-sm", "view-lg"]),
      ).toBe(true);
  });

  it("honours an explicit smaller budget", async () => {
    await gallery();
    await photos(10);
    await mark();
    const { drive } = fakeDrive();
    await warmPendingGalleries(e, drive, { budget: 10 });
    expect(drive.subrequests()).toBeLessThanOrEqual(10);
  });

  it("Prueba: only watermarked files are fetched and stored", async () => {
    await gallery({ mode: "proofing" });
    await photos(6);
    await mark();
    const { drive, calls } = fakeDrive();
    await warmPendingGalleries(e, drive);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toMatch(/^(WM|TWM)-/);
    expect(await marker()).toBeUndefined();
  });

  it("never warms while the sync lock is held; the marker stays", async () => {
    await gallery();
    await photos(3);
    await mark();
    await putSetting(
      e,
      SETTINGS_KEYS.syncLock,
      `${new Date(Date.now() + 60_000).toISOString()}|x`,
    );
    const { drive, calls } = fakeDrive();
    await warmPendingGalleries(e, drive);
    expect(calls).toHaveLength(0);
    expect(await marker()).toBeDefined();
  });

  it.each([
    ["draft", { status: "draft" }],
    ["archived", { status: "archived" }],
    ["expired", { expiresAt: "2020-01-01T00:00:00.000Z" }],
  ])("%s galleries are skipped and unmarked", async (_n, over) => {
    await gallery(over);
    await photos(3);
    await mark();
    const { drive, calls } = fakeDrive();
    await warmPendingGalleries(e, drive);
    expect(calls).toHaveLength(0);
    expect(await marker()).toBeUndefined();
  });

  it("a marker of a gallery that no longer exists is dropped", async () => {
    await mark("gone-gallery");
    const { drive, calls } = fakeDrive();
    await warmPendingGalleries(e, drive);
    expect(calls).toHaveLength(0);
    expect(await marker("gone-gallery")).toBeUndefined();
  });

  it("a gallery whose photos were all deleted fetches nothing and clears", async () => {
    await gallery();
    await photos(3);
    await db.delete(schema.photos).where(eq(schema.photos.galleryId, G));
    await mark();
    const { drive, calls } = fakeDrive();
    await warmPendingGalleries(e, drive);
    expect(calls).toHaveLength(0);
    expect(await marker()).toBeUndefined();
  });

  it("a changed photo is re-warmed (version bump) and only that one", async () => {
    await gallery();
    await photos(4);
    await mark();
    await warmPendingGalleries(e, fakeDrive().drive);
    expect(await marker()).toBeUndefined();
    const id = G.slice(-3) + pid(1);
    await db
      .update(schema.photos)
      .set({ variantVersions: versions("9") })
      .where(eq(schema.photos.id, id));
    await mark();
    const { drive, calls } = fakeDrive();
    await warmPendingGalleries(e, drive);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toContain(id);
    expect(await marker()).toBeUndefined();
  });

  it("a failing Drive keeps the marker so the next run retries", async () => {
    await gallery();
    await photos(3);
    await mark();
    const { drive } = fakeDrive(new Set(["TH-" + G.slice(-3) + pid(0)]));
    await warmPendingGalleries(e, drive);
    expect(await marker()).toBeDefined();
  });

  it("does nothing in mock mode", async () => {
    await gallery();
    await photos(2);
    await mark();
    const { drive, calls } = fakeDrive();
    await warmPendingGalleries({ ...e, DRIVE_MODE: "mock" } as Env, drive);
    expect(calls).toHaveLength(0);
  });
});

describe("T6.39 scheduleWarmAfterSync (waitUntil guard)", () => {
  const result = (over: Partial<SyncResult> = {}): SyncResult => ({
    galleries: { created: 0, updated: 0, archived: 0 },
    photos: { added: 2, updated: 0, removed: 0 },
    issues: 0,
    subrequests: 8,
    ...over,
  });
  const run = (r: SyncResult, mode = "google") => {
    const queued: Promise<unknown>[] = [];
    const { drive, calls } = fakeDrive();
    scheduleWarmAfterSync(
      { ...e, DRIVE_MODE: mode } as Env,
      { ctx: { waitUntil: (p) => void queued.push(p) }, drive },
      r,
    );
    return { queued, calls, drive };
  };
  it("schedules a bounded warm when the sync left budget", async () => {
    await gallery();
    await photos(20);
    await mark();
    const { queued, calls, drive } = run(result());
    expect(queued).toHaveLength(1);
    await queued[0];
    expect(calls.length).toBeGreaterThan(0);
    // the sync already spent 8 of the 50: the warm may use only what is left
    expect(drive.subrequests() + 8).toBeLessThanOrEqual(50 - 5);
  });
  it.each([
    ["skipped", result({ skipped: "unchanged" })],
    [
      "no photo change",
      result({ photos: { added: 0, updated: 0, removed: 3 } }),
    ],
    ["sync used the budget", result({ subrequests: 44 })],
  ])("does not schedule: %s", (_n, r) => {
    expect(run(r).queued).toHaveLength(0);
  });
  it("does not schedule without ctx/drive or in mock mode", () => {
    expect(run(result(), "mock").queued).toHaveLength(0);
    expect(() => scheduleWarmAfterSync(e, undefined, result())).not.toThrow();
  });
});

describe("T6.39 runWarmCron", () => {
  it("continues pending galleries when the cron has nothing stale (idle)", async () => {
    await gallery();
    await photos(3);
    await mark();
    await putSetting(
      e,
      SETTINGS_KEYS.warmIdle,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const { drive, calls } = fakeDrive();
    await runWarmCron(e, drive);
    expect(calls.some((c) => c.startsWith("HI-"))).toBe(true);
  });
  it("does not add a pending warm on top of a cron run that found stale photos", async () => {
    await gallery();
    await photos(3);
    await mark();
    const { drive, calls } = fakeDrive();
    await runWarmCron(e, drive);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.startsWith("HI-"))).toBe(false);
    expect(await marker()).toBeDefined();
  });
  it("pending galleries keep the idle back-off from hiding them", async () => {
    await gallery();
    await photos(2);
    await mark();
    await runWarmCron(e, fakeDrive().drive); // warms thumb/view-sm via the stale scan
    const { drive, calls } = fakeDrive();
    await runWarmCron(e, drive); // nothing stale now: pending continues
    expect(calls.some((c) => c.startsWith("HI-"))).toBe(true);
  });
});
