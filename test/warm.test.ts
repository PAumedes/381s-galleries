import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, nowIso, schema } from "../app/db";
import type { DriveClient } from "../app/lib/server/drive-types";
import { DriveError } from "../app/lib/server/drive-types";
import {
  expectedWarmKey,
  runScheduledWarm,
  warmBatch,
  warmProgress,
} from "../app/lib/server/warm";
import { dispatchScheduled } from "../app/lib/server/scheduled";
import { putSetting, getSetting } from "../app/lib/server/settings";
import { setupData } from "../app/routes/admin.setup";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "google" } as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});

/** Fake Drive: every streamFile costs `cost(id)` subrequests (retries / refresh). */
function fakeDrive(
  o: { fail?: Set<string>; cost?: (id: string) => number } = {},
) {
  let subs = 0;
  const calls: string[] = [];
  const drive = {
    subrequests: () => subs,
    async streamFile(id: string) {
      calls.push(id);
      subs += o.cost?.(id) ?? 1;
      if (o.fail?.has(id)) throw new DriveError(500, "x", "detail " + id);
      return new Response(JPEG.slice(), {
        headers: { "Content-Length": String(JPEG.length) },
      });
    },
  } as unknown as DriveClient;
  return { drive, calls };
}

let n = 0;
async function gallery(id: string, over: Record<string, unknown> = {}) {
  await db.insert(schema.galleries).values({
    id,
    driveFolderId: "folder-" + id,
    slug: "s-" + id,
    title: "T",
    status: "published",
    createdAt: nowIso(new Date(Date.UTC(2026, 0, 1, 0, 0, ++n))),
    ...over,
  });
}
async function photo(
  id: string,
  galleryId: string,
  over: Record<string, unknown> = {},
) {
  await db.insert(schema.photos).values({
    id,
    galleryId,
    baseName: id,
    driveHighresId: `HI-${id}`,
    driveWebId: `WEB-${id}`,
    driveThumbId: `TH-${id}`,
    driveWmId: `WM-${id}`,
    variantVersions: JSON.stringify({
      highres: "2026-01-01T00:00:01Z",
      web: "2026-01-01T00:00:02Z",
      thumb: "2026-01-01T00:00:03Z",
      wm: "2026-01-01T00:00:04Z",
    }),
    width: 300,
    height: 200,
    ...over,
  });
}
const row = async (id: string) =>
  (await db.select().from(schema.photos).where(eq(schema.photos.id, id)))[0];

beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.delete(schema.settings);
  for (const o of (await env.CACHE.list()).objects)
    await env.CACHE.delete(o.key);
});

describe("warmBatch", () => {
  it("warms thumb + view-sm only, writes the marker and R2 metadata", async () => {
    await gallery("g1");
    await photo("p1", "g1");
    const { drive, calls } = fakeDrive();
    const r = await warmBatch(e, { drive });
    expect(r.warmed).toBe(1);
    expect(calls.sort()).toEqual(["TH-p1", "WEB-p1"]);
    expect(await env.CACHE.head("p1/view-lg")).toBeNull();
    const t = await env.CACHE.head("p1/thumb");
    expect(t?.customMetadata).toEqual({
      fileId: "TH-p1",
      wm: "0",
      v: "2026-01-01T00:00:03Z",
    });
    expect(t?.httpMetadata?.contentType).toBe("image/jpeg");
    expect((await env.CACHE.head("p1/view-sm"))?.customMetadata?.fileId).toBe(
      "WEB-p1",
    );
    expect((await row("p1")).cacheWarmKey).toBe(
      await expectedWarmKey(await row("p1"), false),
    );
  });

  it("selects only stale photos (second run does nothing)", async () => {
    await gallery("g1");
    await photo("p1", "g1");
    await photo("p2", "g1");
    const a = fakeDrive();
    await warmBatch(e, { drive: a.drive });
    expect(a.calls).toHaveLength(4);
    const b = fakeDrive();
    const r = await warmBatch(e, { drive: b.drive });
    expect(b.calls).toHaveLength(0);
    expect(r.warmed).toBe(0);
    expect(r.stale).toBe(0);
  });

  it("a changed version makes just that photo stale again", async () => {
    await gallery("g1");
    await photo("p1", "g1");
    await photo("p2", "g1");
    await warmBatch(e, { drive: fakeDrive().drive });
    await db
      .update(schema.photos)
      .set({
        variantVersions: JSON.stringify({
          web: "2027-01-01T00:00:00Z",
          thumb: "2026-01-01T00:00:03Z",
        }),
      })
      .where(eq(schema.photos.id, "p2"));
    const b = fakeDrive();
    await warmBatch(e, { drive: b.drive });
    // thumb still valid in R2 (no Drive call); only view-sm re-fetched.
    expect(b.calls).toEqual(["WEB-p2"]);
  });

  it("skips archived galleries and invisible photos; newest gallery first", async () => {
    await gallery("old");
    await gallery("new");
    await gallery("arch", { status: "archived" });
    await photo("po", "old");
    await photo("pn", "new");
    await photo("pa", "arch");
    await photo("pm", "new", { missingSince: "2026-01-01T00:00:00Z" });
    const { drive, calls } = fakeDrive();
    await warmBatch(e, { drive });
    expect(calls).toEqual(["TH-pn", "WEB-pn", "TH-po", "WEB-po"]);
    expect((await row("pa")).cacheWarmKey).toBeNull();
    expect((await row("pm")).cacheWarmKey).toBeNull();
  });

  it("respects the budget (stops at 40 Drive calls)", async () => {
    await gallery("g1");
    for (let i = 0; i < 30; i++)
      await photo("p" + String(i).padStart(2, "0"), "g1");
    const { drive, calls } = fakeDrive();
    const r = await warmBatch(e, { drive });
    expect(calls).toHaveLength(40);
    expect(r.warmed).toBe(20);
    expect(r.stopped).toBe("budget");
    const warmed = (await db.select().from(schema.photos)).filter(
      (p) => p.cacheWarmKey,
    );
    expect(warmed).toHaveLength(20);
  });

  it("counts retries/refreshes (cost 3 per call) and never exceeds the budget", async () => {
    await gallery("g1");
    for (let i = 0; i < 10; i++) await photo("p" + i, "g1");
    const { drive, calls } = fakeDrive({ cost: () => 3 });
    await warmBatch(e, { drive, budget: 10 });
    // before each call used+1 must fit: calls at used 0,3,6,9 -> 4 calls.
    expect(calls).toHaveLength(4);
    expect(drive.subrequests()).toBeLessThanOrEqual(12);
  });

  it("proofing warms preview-wm view-sm and thumb-wm ?? preview-wm thumb, never clean files", async () => {
    await gallery("g1", { mode: "proofing" });
    await photo("a", "g1");
    await photo("b", "g1", { driveThumbId: null });
    await photo("c", "g1", { driveWmId: null });
    await photo("d", "g1", {
      driveThumbWmId: "TWM-d",
      variantVersions: JSON.stringify({
        highres: "2026-01-01T00:00:01Z",
        web: "2026-01-01T00:00:02Z",
        thumb: "2026-01-01T00:00:03Z",
        wm: "2026-01-01T00:00:04Z",
        thumbWm: "2026-01-01T00:00:05Z",
      }),
    });
    const { drive, calls } = fakeDrive();
    await warmBatch(e, { drive });
    expect(calls.sort()).toEqual([
      "TWM-d",
      "WM-a",
      "WM-a",
      "WM-b",
      "WM-b",
      "WM-d",
    ]);
    expect((await env.CACHE.head("a/view-sm"))?.customMetadata).toMatchObject({
      fileId: "WM-a",
      wm: "1",
    });
    expect((await env.CACHE.head("a/thumb"))?.customMetadata).toMatchObject({
      fileId: "WM-a",
      wm: "1",
    });
    expect((await env.CACHE.head("d/thumb"))?.customMetadata).toMatchObject({
      fileId: "TWM-d",
      wm: "1",
    });
    expect((await env.CACHE.head("b/thumb"))?.customMetadata).toMatchObject({
      fileId: "WM-b",
    });
    expect(await env.CACHE.head("c/view-sm")).toBeNull();
  });

  it("toggling the watermark makes photos stale (different key)", async () => {
    await gallery("g1");
    await photo("p1", "g1");
    await warmBatch(e, { drive: fakeDrive().drive });
    await db.update(schema.galleries).set({ mode: "proofing" });
    const b = fakeDrive();
    await warmBatch(e, { drive: b.drive });
    expect(b.calls).toContain("WM-p1");
  });

  it("a failure leaves the marker unchanged, the batch continues, next run retries", async () => {
    await gallery("g1");
    await photo("p1", "g1");
    await photo("p2", "g1");
    const bad = fakeDrive({ fail: new Set(["WEB-p1"]) });
    const r = await warmBatch(e, { drive: bad.drive });
    expect(r.failed).toBe(1);
    expect(r.warmed).toBe(1);
    expect((await row("p1")).cacheWarmKey).toBeNull();
    expect((await row("p2")).cacheWarmKey).not.toBeNull();
    // The photo is backed off for a minute; let the retry time pass.
    await db
      .update(schema.photos)
      .set({ cacheWarmRetryAt: "2020-01-01T00:00:00.000Z" });
    const ok = fakeDrive();
    await warmBatch(e, { drive: ok.drive });
    expect(ok.calls).toEqual(["WEB-p1"]); // thumb was already cached
    expect((await row("p1")).cacheWarmKey).not.toBeNull();
  });

  it("does not leak Drive ids in logs-free result", async () => {
    await gallery("g1");
    await photo("p1", "g1");
    const r = await warmBatch(e, { drive: fakeDrive().drive });
    expect(JSON.stringify(r)).not.toContain("TH-p1");
  });
});

describe("warmProgress + admin counter", () => {
  it("counts warmed vs visible photos (stale markers are not warmed)", async () => {
    await gallery("g1");
    await photo("p1", "g1");
    await photo("p2", "g1");
    await photo("p3", "g1", { missingSince: "2026-01-01T00:00:00Z" });
    expect(await warmProgress(e)).toEqual({ warmed: 0, total: 2 });
    await warmBatch(e, { drive: fakeDrive().drive, budget: 2 });
    expect(await warmProgress(e)).toEqual({ warmed: 1, total: 2 });
    await db
      .update(schema.photos)
      .set({ cacheWarmKey: "stale" })
      .where(eq(schema.photos.id, "p1"));
    expect((await warmProgress(e)).warmed).toBe(0);
  });

  it("setup page data carries cacheWarm", async () => {
    await gallery("g1");
    await photo("p1", "g1");
    const ae = { ...e, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
    const d = await setupData(new Request("http://localhost/admin/setup"), ae);
    expect(d.cacheWarm).toEqual({ warmed: 0, total: 1 });
  });
});

describe("runScheduledWarm", () => {
  beforeEach(async () => {
    await gallery("g1");
    await photo("p1", "g1");
  });

  it("is skipped while the sync lock is held", async () => {
    await putSetting(
      e,
      "sync_lock",
      `${nowIso(new Date(Date.now() + 60_000))}|abc`,
    );
    const { drive, calls } = fakeDrive();
    const r = await runScheduledWarm(e, drive);
    expect(r.skipped).toBe("sync_running");
    expect(calls).toHaveLength(0);
  });

  it("an expired sync lock does not block", async () => {
    await putSetting(
      e,
      "sync_lock",
      `${nowIso(new Date(Date.now() - 60_000))}|abc`,
    );
    const r = await runScheduledWarm(e, fakeDrive().drive);
    expect(r.skipped).toBeUndefined();
    expect(r.warmed).toBe(1);
  });

  it("two warm runs never overlap (lock), and the lock is released", async () => {
    const slow = fakeDrive();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const orig = slow.drive.streamFile.bind(slow.drive);
    slow.drive.streamFile = async (id, o) => {
      await gate;
      return orig(id, o);
    };
    const first = runScheduledWarm(e, slow.drive);
    await new Promise((r) => setTimeout(r, 50));
    const other = fakeDrive();
    const second = await runScheduledWarm(e, other.drive);
    expect(second.skipped).toBe("locked");
    expect(other.calls).toHaveLength(0);
    release();
    expect((await first).warmed).toBe(1);
    expect(await getSetting(e, "warm_lock")).toBeUndefined();
    const third = await runScheduledWarm(e, fakeDrive().drive);
    expect(third.skipped).not.toBe("locked");
  });

  it("an expired warm lock can be taken over", async () => {
    await putSetting(
      e,
      "warm_lock",
      `${nowIso(new Date(Date.now() - 1000))}|dead`,
    );
    expect((await runScheduledWarm(e, fakeDrive().drive)).warmed).toBe(1);
  });

  it("when nothing needs warming it makes zero Drive calls", async () => {
    await runScheduledWarm(e, fakeDrive().drive);
    const f = fakeDrive();
    const r = await runScheduledWarm(e, f.drive);
    expect(f.calls).toHaveLength(0);
    expect(f.drive.subrequests()).toBe(0);
    expect(r.warmed ?? 0).toBe(0);
  });

  it("does nothing in mock mode", async () => {
    const f = fakeDrive();
    const r = await runScheduledWarm(
      { ...e, DRIVE_MODE: "mock" } as Env,
      f.drive,
    );
    expect(r.skipped).toBe("mock");
    expect(f.calls).toHaveLength(0);
  });
});

describe("dispatchScheduled", () => {
  const spies = () => {
    const calls: string[] = [];
    return {
      calls,
      handlers: {
        sync: async () => void calls.push("sync"),
        warm: async () => void calls.push("warm"),
      },
    };
  };
  it("15-minute cron runs sync only", async () => {
    const s = spies();
    await dispatchScheduled("*/15 * * * *", e, s.handlers);
    expect(s.calls).toEqual(["sync"]);
  });
  it("1-minute cron runs warm only", async () => {
    const s = spies();
    await dispatchScheduled("* * * * *", e, s.handlers);
    expect(s.calls).toEqual(["warm"]);
  });
  it("unknown cron falls back to sync (legacy trigger)", async () => {
    const s = spies();
    await dispatchScheduled("0 3 * * *", e, s.handlers);
    expect(s.calls).toEqual(["sync"]);
  });
  it("wrangler declares both crons", async () => {
    const txt = await import("../wrangler.jsonc?raw").then((m) => m.default);
    expect(txt).toContain('"*/15 * * * *"');
    expect(txt).toContain('"* * * * *"');
  });
});

describe("per-photo back-off (T6.2 fixes)", () => {
  const noLen = () => {
    const d = fakeDrive();
    d.drive.streamFile = async () => new Response(JPEG.slice());
    return d;
  };

  it("a failure counts, schedules a retry (1m, 5m, 1h, 24h) and hides the photo until then", async () => {
    await gallery("g1");
    await photo("p1", "g1");
    const bad = fakeDrive({ fail: new Set(["TH-p1"]) });
    const before = Date.now();
    await warmBatch(e, { drive: bad.drive });
    let r = await row("p1");
    expect(r.cacheWarmFailCount).toBe(1);
    const at = Date.parse(r.cacheWarmRetryAt!);
    expect(at).toBeGreaterThanOrEqual(before + 60_000 - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 60_000 + 1000);
    const again = fakeDrive({ fail: new Set(["TH-p1"]) });
    await warmBatch(e, { drive: again.drive });
    expect(again.calls).toHaveLength(0);
    for (const [count, ms] of [
      [2, 5 * 60_000],
      [3, 3_600_000],
      [4, 86_400_000],
      [5, 86_400_000],
    ] as const) {
      await db
        .update(schema.photos)
        .set({ cacheWarmRetryAt: nowIso(new Date(Date.now() - 1000)) })
        .where(eq(schema.photos.id, "p1"));
      const t0 = Date.now();
      await warmBatch(e, { drive: bad.drive });
      r = await row("p1");
      expect(r.cacheWarmFailCount).toBe(count);
      expect(Date.parse(r.cacheWarmRetryAt!) - t0).toBeGreaterThanOrEqual(
        ms - 1000,
      );
      expect(Date.parse(r.cacheWarmRetryAt!) - t0).toBeLessThanOrEqual(
        ms + 5000,
      );
    }
  });

  it("success clears the counters; never-failed photos are tried before retried ones", async () => {
    await gallery("g1");
    await photo("a", "g1", {
      cacheWarmFailCount: 2,
      cacheWarmRetryAt: "2020-01-01T00:00:00.000Z",
    });
    await photo("b", "g1");
    const d = fakeDrive();
    await warmBatch(e, { drive: d.drive });
    expect(d.calls.slice(0, 2).sort()).toEqual(["TH-b", "WEB-b"]);
    const a = await row("a");
    expect(a.cacheWarmFailCount).toBe(0);
    expect(a.cacheWarmRetryAt).toBeNull();
    expect(a.cacheWarmKey).not.toBeNull();
  });

  it("a skipped fill (no Content-Length) is a failure and never sets the marker", async () => {
    await gallery("g1");
    await photo("p1", "g1");
    const r = await warmBatch(e, { drive: noLen().drive });
    expect(r.warmed).toBe(0);
    expect(r.failed).toBe(1);
    const p = await row("p1");
    expect(p.cacheWarmKey).toBeNull();
    expect(p.cacheWarmFailCount).toBe(1);
    expect((await warmProgress(e)).warmed).toBe(0);
  });

  it("a change of versions or file ids resets the back-off", async () => {
    await gallery("g1");
    await photo("p1", "g1", {
      cacheWarmFailCount: 3,
      cacheWarmRetryAt: "2999-01-01T00:00:00.000Z",
    });
    await db
      .update(schema.photos)
      .set({ driveThumbId: "NEW" })
      .where(eq(schema.photos.id, "p1"));
    let p = await row("p1");
    expect(p.cacheWarmFailCount).toBe(0);
    expect(p.cacheWarmRetryAt).toBeNull();
    await db
      .update(schema.photos)
      .set({
        cacheWarmFailCount: 3,
        cacheWarmRetryAt: "2999-01-01T00:00:00.000Z",
      })
      .where(eq(schema.photos.id, "p1"));
    await db
      .update(schema.photos)
      .set({ variantVersions: JSON.stringify({ web: "x" }) })
      .where(eq(schema.photos.id, "p1"));
    p = await row("p1");
    expect(p.cacheWarmFailCount).toBe(0);
    await db
      .update(schema.photos)
      .set({
        cacheWarmFailCount: 3,
        cacheWarmRetryAt: "2999-01-01T00:00:00.000Z",
      })
      .where(eq(schema.photos.id, "p1"));
    await db.update(schema.galleries).set({ mode: "proofing" });
    expect((await row("p1")).cacheWarmFailCount).toBe(0);
  });
});

describe("bounded selection", () => {
  it("looks at no more than 200 stale rows per run", async () => {
    await gallery("g1");
    const ids = Array.from(
      { length: 250 },
      (_, i) => "p" + String(i).padStart(3, "0"),
    );
    for (let i = 0; i < ids.length; i += 10)
      await db.insert(schema.photos).values(
        ids.slice(i, i + 10).map((id) => ({
          id,
          galleryId: "g1",
          baseName: id,
          driveHighresId: "HI" + id,
          driveWebId: "WEB-" + id,
          driveThumbId: "TH-" + id,
          variantVersions: JSON.stringify({ web: "w", thumb: "t" }),
        })),
      );
    const r = await warmBatch(e, { drive: fakeDrive().drive, budget: 2 });
    expect(r.stale).toBeLessThanOrEqual(200);
    expect(r.stale).toBeGreaterThan(0);
    expect(await warmProgress(e)).toEqual({ warmed: 1, total: 250 });
  });
});

describe("re-check before each fill", () => {
  it("skips photos that became invisible or whose watermark flag changed meanwhile", async () => {
    await gallery("g1");
    await gallery("g0"); // newer: processed first
    await photo("a", "g0");
    await photo("b", "g1");
    await photo("c", "g1");
    const d = fakeDrive();
    const orig = d.drive.streamFile.bind(d.drive);
    let first = true;
    d.drive.streamFile = async (id, o) => {
      if (first) {
        first = false;
        await db
          .update(schema.photos)
          .set({ missingSince: "2026-01-01T00:00:00Z" })
          .where(eq(schema.photos.id, "b"));
        await db
          .update(schema.galleries)
          .set({ mode: "proofing" })
          .where(eq(schema.galleries.id, "g1"));
      }
      return orig(id, o);
    };
    const r = await warmBatch(e, { drive: d.drive });
    expect(d.calls.sort()).toEqual(["TH-a", "WEB-a"]);
    expect(r.warmed).toBe(1);
    expect((await row("b")).cacheWarmKey).toBeNull();
    expect((await row("c")).cacheWarmKey).toBeNull();
    expect((await row("b")).cacheWarmFailCount).toBe(0);
  });
});

describe("warm_idle invalidation", () => {
  const idleFuture = () => nowIso(new Date(Date.now() + 300_000));

  it("a watermark toggle, a photo insert or a version change clears warm_idle", async () => {
    await gallery("g1");
    await photo("p1", "g1");
    await putSetting(e, "warm_idle", idleFuture());
    await db.update(schema.galleries).set({ mode: "proofing" });
    expect(await getSetting(e, "warm_idle")).toBeUndefined();
    await putSetting(e, "warm_idle", idleFuture());
    await photo("p2", "g1");
    expect(await getSetting(e, "warm_idle")).toBeUndefined();
    await putSetting(e, "warm_idle", idleFuture());
    await db
      .update(schema.photos)
      .set({ variantVersions: "{}" })
      .where(eq(schema.photos.id, "p2"));
    expect(await getSetting(e, "warm_idle")).toBeUndefined();
  });

  it("idle is not set when a toggle lands during the run", async () => {
    await gallery("g1");
    await photo("p1", "g1");
    await warmBatch(e, { drive: fakeDrive().drive });
    let armed = true;
    const wrap = (stmt: D1PreparedStatement, q: string): D1PreparedStatement =>
      new Proxy(stmt, {
        get(t, k) {
          const v = Reflect.get(t, k, t);
          if (typeof v !== "function") return v;
          if (k === "bind")
            return (...a: unknown[]) =>
              wrap(
                (v as (...x: unknown[]) => D1PreparedStatement).apply(t, a),
                q,
              );
          return async (...a: unknown[]) => {
            // The toggle lands right after the stale scan has been read.
            const out = await (v as (...x: unknown[]) => unknown).apply(t, a);
            if (
              armed &&
              /from ["`]photos["`]/i.test(q) &&
              (k === "all" || k === "raw")
            ) {
              armed = false;
              await db.update(schema.galleries).set({ mode: "proofing" });
            }
            return out;
          };
        },
      });
    const proxied = new Proxy(env.DB, {
      get(t, k) {
        const v = Reflect.get(t, k, t);
        if (k === "prepare") return (q: string) => wrap(t.prepare(q), q);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const pe = { ...e, DB: proxied } as Env;
    const r = await runScheduledWarm(pe, fakeDrive().drive);
    expect(armed).toBe(false);
    expect(r.stale).toBe(0);
    expect(await getSetting(e, "warm_idle")).toBeUndefined();
  });
});
