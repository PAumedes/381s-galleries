import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, nowIso, schema } from "../../app/db";
import { DriveError } from "../../app/lib/server/drive-types";
import type { DriveClient } from "../../app/lib/server/drive-types";
import { putSetting, SETTINGS_KEYS } from "../../app/lib/server/settings";
import {
  runWarmCron,
  warmPendingGalleries,
} from "../../app/lib/server/warm-after-sync";

const db = getDb(env);
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const PENDING = SETTINGS_KEYS.warmPendingPrefix;
const gid = (n: number) => `gggggggg-0000-0000-0000-0000000000a${n}`;
const pid = (g: string, i: number) =>
  `${g.slice(-2)}p${String(i).padStart(3, "0")}`;

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await db.delete(schema.galleries);
  await resetTables("settings", "rate_limits");
  await clearCache();
});

const versions = () =>
  JSON.stringify(
    Object.fromEntries(
      ["highres", "web", "thumb", "wm", "thumbWm"].map((k) => [
        k,
        "2026-01-01T00:00:01Z",
      ]),
    ),
  );

async function gallery(id: string, over: Record<string, unknown> = {}) {
  await db.insert(schema.galleries).values({
    id,
    driveFolderId: "f-" + id,
    slug: "s-" + id.slice(-2),
    title: "T",
    status: "published",
    ...over,
  });
}
async function photos(g: string, n: number, withWm = true) {
  for (let i = 0; i < n; i++) {
    const id = pid(g, i);
    await db.insert(schema.photos).values({
      id,
      galleryId: g,
      baseName: id,
      driveHighresId: `HI-${id}`,
      driveWebId: `WEB-${id}`,
      driveThumbId: `TH-${id}`,
      driveWmId: withWm ? `WM-${id}` : null,
      driveThumbWmId: withWm ? `TWM-${id}` : null,
      variantVersions: versions(),
      width: 300,
      height: 200,
    });
  }
}
function fakeDrive(
  hook?: (id: string) => Promise<void> | void,
  fail: (id: string) => boolean = () => false,
) {
  let subs = 0;
  const calls: string[] = [];
  const drive = {
    subrequests: () => subs,
    async streamFile(id: string) {
      calls.push(id);
      subs++;
      await hook?.(id);
      if (fail(id)) throw new DriveError(404, "x", "d " + id);
      return new Response(JPEG.slice(), {
        headers: { "Content-Length": String(JPEG.length) },
      });
    },
  } as unknown as DriveClient;
  return { drive, calls };
}
function counting() {
  let n = 0;
  const DB = new Proxy(env.DB, {
    get(t, p) {
      const v = (t as never)[p];
      if (p === "prepare")
        return (s: string) => {
          n++;
          return (v as (s: string) => unknown).call(t, s);
        };
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  return { e: { ...env, DB, DRIVE_MODE: "google" } as Env, count: () => n };
}
const e = { ...env, DRIVE_MODE: "google" } as Env;
const mark = (id: string, at = nowIso()) => putSetting(e, PENDING + id, at);
const marker = async (id: string) =>
  (
    await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, PENDING + id))
  )[0];

describe("T6.39 adversarial", () => {
  it("Entrega->Prueba switch mid-warm: no unwatermarked file may be fetched after the switch", async () => {
    const g = gid(1);
    await gallery(g);
    await photos(g, 6);
    await mark(g);
    let switched = false;
    const { drive, calls } = fakeDrive(async (id) => {
      if (!switched) {
        switched = true;
        await db
          .update(schema.galleries)
          .set({ mode: "proofing" })
          .where(eq(schema.galleries.id, g));
      }
      void id;
    });
    await warmPendingGalleries(e, drive);
    const [first, ...after] = calls;
    expect(first).toBeDefined();
    for (const c of after) expect(c).toMatch(/^(WM|TWM)-/);
  });

  it("D1 queries of one warm run are bounded even when every file is already cached (no Drive calls)", async () => {
    const g = gid(2);
    await gallery(g);
    await photos(g, 40);
    await mark(g);
    await warmPendingGalleries(e, fakeDrive().drive); // fill what fits
    for (let i = 0; i < 12; i++) {
      await resetTables("rate_limits");
      await warmPendingGalleries(e, fakeDrive().drive);
    }
    // everything cached now; restart the cursor as a sync would
    await db
      .update(schema.settings)
      .set({ value: "x" })
      .where(eq(schema.settings.key, "warm_stamp"));
    await mark(g);
    await resetTables("rate_limits");
    const c = counting();
    const { drive, calls } = fakeDrive();
    await warmPendingGalleries(c.e, drive, { budget: 16 });
    // The sync that precedes this waitUntil already used D1 queries in the same invocation.
    expect(calls.length).toBeLessThanOrEqual(16);
    expect(c.count()).toBeLessThanOrEqual(30);
  });

  it("minute cron with a large pending library stays within 50 D1 queries", async () => {
    for (const n of [3, 4, 5]) {
      await gallery(gid(n));
      await photos(gid(n), 40);
      await mark(gid(n));
    }
    const c = counting();
    const { drive } = fakeDrive();
    await runWarmCron(c.e, drive);
    expect(c.count()).toBeLessThanOrEqual(50);
  });

  it("permanently failing galleries do not starve newer marked galleries", async () => {
    for (const n of [1, 2, 3, 4]) {
      await gallery(gid(n));
      await photos(gid(n), 2);
      await mark(gid(n), `2026-01-01T00:00:0${n}.000Z`);
    }
    const bad = (id: string) => /^(TH|WEB|HI)-0[123]/.test(id);
    for (let i = 0; i < 12; i++) {
      await resetTables("rate_limits");
      await warmPendingGalleries(e, fakeDrive(undefined, bad).drive);
    }
    expect(await env.CACHE.head(`${pid(gid(4), 0)}/thumb`)).not.toBeNull();
  });

  it("a deleted gallery leaves no warm_pending row even if it was marked after a cursor-less delete", async () => {
    const g = gid(6);
    await gallery(g);
    await mark(g);
    const { deleteGallery } =
      await import("../../app/lib/server/gallery-delete");
    await (deleteGallery as (e: Env, id: string) => Promise<unknown>)(e, g);
    expect(await marker(g)).toBeUndefined();
  });
});
