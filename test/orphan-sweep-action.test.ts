import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "../app/db";
import { getSetting, SETTINGS_KEYS } from "../app/lib/server/settings";
import { setupAction } from "../app/routes/admin.setup";
import { fakeBucket, uuid } from "./support/fake-r2";
import { migrateDb, resetTables } from "./support/d1";

/** T6.59: the admin intents 'sweepScan' / 'sweepDelete' on /admin/setup. */
const db = getDb(env);
const base = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const URL_ = "http://localhost/admin/setup";
const post = (fields: Record<string, string>, headers: HeadersInit = {}) =>
  new Request(URL_, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  });

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("settings", "photos", "galleries");
});

const withBucket = (n: number) => {
  const f = fakeBucket(n);
  return { f, e: { ...base, CACHE: f.bucket as R2Bucket } as Env };
};
const scanAll = async (e: Env) => {
  let fields: Record<string, string> = { intent: "sweepScan" };
  for (;;) {
    const r = await setupAction(post(fields), e);
    if (!r.sweep || r.sweep.cursor === null) return r;
    fields = {
      intent: "sweepScan",
      cursor: r.sweep.cursor,
      totals: JSON.stringify(r.sweep.totals),
    };
  }
};

describe("T6.59 sweep intents: access", () => {
  it("needs the admin login", async () => {
    const { e } = withBucket(3);
    await expect(
      setupAction(post({ intent: "sweepScan" }), {
        ...e,
        ALLOW_DEV_ADMIN: "0",
      } as Env),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("refuses cross-site posts", async () => {
    const { f, e } = withBucket(3);
    await expect(
      setupAction(
        post(
          { intent: "sweepDelete", confirm: "1" },
          { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" },
        ),
        e,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.calls.list).toBe(0);
  });
});

describe("T6.59 sweep intents: scan", () => {
  it("returns a bounded page with a cursor and totals, and deletes nothing", async () => {
    const { f, e } = withBucket(2400);
    const r = await setupAction(post({ intent: "sweepScan" }), e);
    expect(r).toMatchObject({ intent: "sweepScan", ok: true });
    expect(r.sweep?.phase).toBe("scan");
    expect(r.sweep?.cursor).toBeTruthy();
    expect(r.sweep?.totals).toMatchObject({ scanned: 1000, orphans: 1000 });
    expect(f.live.size).toBe(2400);
  });

  it("continues from the posted cursor and totals; the last page has no cursor and records the scan", async () => {
    const { e } = withBucket(2400);
    expect(await getSetting(e, SETTINGS_KEYS.orphanSweepScanned)).toBeFalsy();
    const last = await scanAll(e);
    expect(last.sweep).toMatchObject({ cursor: null, done: true });
    expect(last.sweep?.totals.scanned).toBe(2400);
    expect(await getSetting(e, SETTINGS_KEYS.orphanSweepScanned)).toBeTruthy();
  });

  it("garbage totals and cursor are sanitised, never trusted", async () => {
    const { e } = withBucket(30);
    const r = await setupAction(
      post({
        intent: "sweepScan",
        totals: '{"scanned":-5,"orphans":"x","deleted":1e99}',
      }),
      e,
    );
    expect(r.ok).toBe(true);
    expect(r.sweep?.totals).toMatchObject({
      scanned: 30,
      orphans: 30,
      deleted: 0,
    });
    const bad = await setupAction(
      post({ intent: "sweepScan", cursor: "x".repeat(5000) }),
      e,
    );
    expect(bad.ok).toBe(false);
  });

  it("a failing bucket gives a generic error and keeps the progress to retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = {
      list: async () => {
        throw new Error("secret internal detail r2://bucket");
      },
      delete: async () => {},
    } as unknown as R2Bucket;
    const r = await setupAction(
      post({
        intent: "sweepScan",
        cursor: "abc",
        totals: JSON.stringify({ scanned: 7 }),
      }),
      { ...base, CACHE: boom } as Env,
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/secret|bucket/);
    expect(r.sweep).toMatchObject({ cursor: "abc", totals: { scanned: 7 } });
  });
});

describe("T6.59 sweep intents: delete", () => {
  it("is refused without the confirmation", async () => {
    const { f, e } = withBucket(30);
    await scanAll(e);
    const r = await setupAction(post({ intent: "sweepDelete" }), e);
    expect(r.ok).toBe(false);
    expect(f.live.size).toBe(30);
  });

  it("is refused until a finished scan exists (the owner saw the totals first)", async () => {
    const { f, e } = withBucket(30);
    const r = await setupAction(
      post({ intent: "sweepDelete", confirm: "1" }),
      e,
    );
    expect(r.ok).toBe(false);
    expect(f.live.size).toBe(30);
  });

  it("an old finished scan stops being enough", async () => {
    const { f, e } = withBucket(30);
    await scanAll(e);
    await env.DB.prepare("UPDATE settings SET value = ?1 WHERE key = ?2")
      .bind(
        new Date(Date.now() - 3 * 86_400_000).toISOString(),
        SETTINGS_KEYS.orphanSweepScanned,
      )
      .run();
    const r = await setupAction(
      post({ intent: "sweepDelete", confirm: "1" }),
      e,
    );
    expect(r.ok).toBe(false);
    expect(f.live.size).toBe(30);
  });

  it("after scan and confirmation it deletes the orphans page by page and forgets the scan", async () => {
    const { f, e } = withBucket(2400);
    await db
      .insert(schema.galleries)
      .values({ id: "g", driveFolderId: "d", slug: "s", title: "t" });
    await db.insert(schema.photos).values({
      id: uuid(0),
      galleryId: "g",
      baseName: "a",
      driveHighresId: "h",
    });
    await scanAll(e);
    let fields: Record<string, string> = {
      intent: "sweepDelete",
      confirm: "1",
    };
    let last;
    for (;;) {
      last = await setupAction(post(fields), e);
      expect(last.ok).toBe(true);
      if (last.sweep?.cursor == null) break;
      fields = {
        ...fields,
        cursor: last.sweep.cursor,
        totals: JSON.stringify(last.sweep.totals),
      };
    }
    expect(last.sweep?.totals.deleted).toBe(2400 - 3);
    expect([...f.live].every((k) => k.startsWith(uuid(0)))).toBe(true);
    expect(await getSetting(e, SETTINGS_KEYS.orphanSweepScanned)).toBeFalsy();
  });
});
