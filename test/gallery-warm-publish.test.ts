import { clearCache } from "./support/cache";
import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import {
  galleryAction,
  loadGalleryEdit,
} from "../app/lib/server/admin-galleries";
import type { DriveClient } from "../app/lib/server/drive-types";
import {
  OPEN_WARM_BUDGET,
  warmGalleryAtPublish,
  warmGalleryOnOpen,
} from "../app/lib/server/gallery-warm";
import { warmProgress } from "../app/lib/server/warm";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "google" } as Env;
const mockAdmin = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const G = "gggggggg-0000-0000-0000-00000000037a";
const SLUG = "s-publish-warm";

beforeAll(async () => {
  await migrateDb();
});

function fakeDrive() {
  let subs = 0;
  const calls: string[] = [];
  const drive = {
    subrequests: () => subs,
    async streamFile(id: string) {
      calls.push(id);
      subs += 1;
      return new Response(JPEG.slice(), {
        headers: { "Content-Length": String(JPEG.length) },
      });
    },
  } as unknown as DriveClient;
  return { drive, calls };
}

function recorder() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
      passThroughOnException() {},
    } as unknown as ExecutionContext,
    done: async () => void (await Promise.all(pending)),
    count: () => pending.length,
  };
}

async function gallery(over: Record<string, unknown> = {}) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "folder-g",
    slug: SLUG,
    title: "T",
    status: "published",
    ...over,
  });
}
const pid = (i: number) => `p${String(i).padStart(3, "0")}`;
async function photos(n: number, over: Record<string, unknown> = {}) {
  for (let i = 0; i < n; i++) {
    const id = pid(i);
    await db.insert(schema.photos).values({
      id,
      galleryId: G,
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
}
/** Covers must point at existing photos (trigger), so they are set after seeding. */
const setCovers = (over: {
  coverPhotoId?: string;
  coverPhotoIdMobile?: string;
}) => db.update(schema.galleries).set(over).where(eq(schema.galleries.id, G));
const cached = async (id: string, v: string) =>
  (await env.CACHE.head(`${id}/${v}`)) !== null;

beforeEach(async () => {
  await db.delete(schema.galleries);
  await resetTables("settings", "rate_limits");
  await clearCache();
});

describe("T6.37 open warm throughput", () => {
  it("one open on a cold gallery warms at least 12 photos (thumb + view-sm)", async () => {
    await gallery();
    await photos(40);
    const { drive } = fakeDrive();
    await warmGalleryOnOpen(e, drive, SLUG);
    let warmed = 0;
    for (let i = 0; i < 40; i++)
      if ((await cached(pid(i), "thumb")) && (await cached(pid(i), "view-sm")))
        warmed++;
    expect(warmed).toBeGreaterThanOrEqual(12);
    // Workers Free: 50 subrequests per invocation; the page itself needs room.
    expect(OPEN_WARM_BUDGET).toBeLessThanOrEqual(40);
  });
});

describe("T6.37 warmGalleryAtPublish", () => {
  it("cover first (thumb, view-sm, view-lg), then the grid in order, within the budget", async () => {
    await gallery();
    await photos(30);
    await setCovers({ coverPhotoId: pid(10) });
    const { drive, calls } = fakeDrive();
    await warmGalleryAtPublish(e, drive, G);
    expect(calls.slice(0, 3)).toEqual(["TH-p010", "WEB-p010", "HI-p010"]);
    expect(calls.slice(3, 5)).toEqual(["TH-p000", "WEB-p000"]);
    expect(calls.length).toBeLessThanOrEqual(OPEN_WARM_BUDGET);
    expect(await cached("p010", "view-lg")).toBe(true);
    expect(await cached("p000", "thumb")).toBe(true);
    expect(await cached("p029", "thumb")).toBe(false);
  });

  it("no chosen cover: the first photo is the cover and gets its view-lg", async () => {
    await gallery();
    await photos(5);
    const { drive, calls } = fakeDrive();
    await warmGalleryAtPublish(e, drive, G);
    expect(calls.slice(0, 3)).toEqual(["TH-p000", "WEB-p000", "HI-p000"]);
    expect(await cached("p000", "view-lg")).toBe(true);
  });

  it("the mobile cover is warmed before the grid too", async () => {
    await gallery();
    await photos(10);
    await setCovers({ coverPhotoId: pid(4), coverPhotoIdMobile: pid(7) });
    const { drive, calls } = fakeDrive();
    await warmGalleryAtPublish(e, drive, G);
    expect(calls.slice(0, 6)).toEqual([
      "TH-p004",
      "WEB-p004",
      "HI-p004",
      "TH-p007",
      "WEB-p007",
      "HI-p007",
    ]);
  });

  it("a draft or archived gallery is never warmed", async () => {
    for (const status of ["draft", "archived"] as const) {
      await db.delete(schema.galleries);
      await gallery({ status });
      await photos(3);
      const { drive, calls } = fakeDrive();
      const r = await warmGalleryAtPublish(e, drive, G);
      expect(r.skipped).toBe("unavailable");
      expect(calls).toHaveLength(0);
    }
  });

  it("shares the cursor with the open warm: nothing is fetched twice", async () => {
    await gallery();
    await photos(30);
    await setCovers({ coverPhotoId: pid(3) });
    const all: string[] = [];
    const a = fakeDrive();
    await warmGalleryAtPublish(e, a.drive, G);
    all.push(...a.calls);
    for (let i = 0; i < 10; i++) {
      const b = fakeDrive();
      await warmGalleryOnOpen(e, b.drive, SLUG);
      all.push(...b.calls);
    }
    expect(new Set(all).size).toBe(all.length);
    for (let i = 0; i < 30; i++)
      expect(await cached(pid(i), "thumb")).toBe(true);
  });

  it("Prueba stores and fetches only watermarked files", async () => {
    await gallery({ mode: "proofing" });
    await photos(3);
    await setCovers({ coverPhotoId: pid(1) });
    const { drive, calls } = fakeDrive();
    await warmGalleryAtPublish(e, drive, G);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.startsWith("WM-"))).toBe(true);
    const h = await env.CACHE.head("p001/view-lg");
    expect(h?.customMetadata?.fileId).toBe("WM-p001");
    expect(h?.customMetadata?.wm).toBe("1");
  });

  it("a failing Drive never throws", async () => {
    await gallery();
    await photos(3);
    const drive = {
      subrequests: () => 0,
      streamFile: () => Promise.reject(new Error("boom")),
    } as unknown as DriveClient;
    await expect(warmGalleryAtPublish(e, drive, G)).resolves.toBeDefined();
  });
});

describe("T6.37 status change schedules the warm", () => {
  const act = (
    fields: Record<string, string>,
    deps?: Parameters<typeof galleryAction>[3],
  ) =>
    galleryAction(
      new Request(`http://localhost/admin/g/${G}`, {
        method: "POST",
        body: new URLSearchParams(fields),
      }),
      mockAdmin,
      G,
      deps,
    );

  it("publish hands a background warm to waitUntil (the answer does not wait)", async () => {
    await gallery({ status: "draft" });
    await photos(6);
    const { drive, calls } = fakeDrive();
    const r = recorder();
    const res = await act(
      { intent: "status", to: "publish" },
      { ctx: r.ctx, drive },
    );
    expect(res.ok).toBe(true);
    expect(r.count()).toBe(1);
    expect(calls).toHaveLength(0);
    await r.done();
    expect(calls.length).toBeGreaterThan(0);
    expect(await cached("p000", "thumb")).toBe(true);
  });

  it("restoring an archived gallery into published warms too", async () => {
    await gallery({ status: "archived", archivedPrevStatus: "published" });
    await photos(2);
    const { drive } = fakeDrive();
    const r = recorder();
    await act({ intent: "status", to: "restore" }, { ctx: r.ctx, drive });
    expect(r.count()).toBe(1);
  });

  it("no warm for draft, archive, other saves, a stale publish, or without ctx/drive", async () => {
    const { drive } = fakeDrive();
    const r = recorder();
    await gallery({ status: "published" });
    await photos(2);
    await act({ intent: "status", to: "draft" }, { ctx: r.ctx, drive });
    await act({ intent: "status", to: "archive" }, { ctx: r.ctx, drive });
    await db
      .update(schema.galleries)
      .set({ status: "published" })
      .where(eq(schema.galleries.id, G));
    await act({ intent: "status", to: "publish" }, { ctx: r.ctx, drive }); // stale
    await act({ intent: "details", title: "Nuevo" }, { ctx: r.ctx, drive });
    expect(r.count()).toBe(0);
    await db
      .update(schema.galleries)
      .set({ status: "draft" })
      .where(eq(schema.galleries.id, G));
    await act({ intent: "status", to: "publish" }); // no deps (mock mode route)
    await act({ intent: "status", to: "draft" });
    await act({ intent: "status", to: "publish" }, { ctx: r.ctx }); // no drive
    expect(r.count()).toBe(0);
  });
});

describe("T6.37 photos-ready indicator", () => {
  it("warmProgress(env, galleryId) counts only that gallery", async () => {
    await gallery();
    await photos(3);
    await db.insert(schema.galleries).values({
      id: "other-g",
      driveFolderId: "f2",
      slug: "other",
      title: "O",
      status: "published",
    });
    await db.insert(schema.photos).values({
      id: "o1",
      galleryId: "other-g",
      baseName: "o1",
      driveHighresId: "x",
      cacheExpectedKey: "k",
      cacheWarmKey: "k",
    });
    await db
      .update(schema.photos)
      .set({ cacheExpectedKey: "a", cacheWarmKey: "a" })
      .where(eq(schema.photos.id, pid(0)));
    expect(await warmProgress(e, G)).toEqual({ warmed: 1, total: 3 });
    expect(await warmProgress(e)).toEqual({ warmed: 2, total: 4 });
  });

  it("the editor data carries it for real Drive modes, null in mock mode", async () => {
    await gallery();
    await photos(2);
    expect((await loadGalleryEdit(e, G))!.cacheProgress).toEqual({
      warmed: 0,
      total: 2,
    });
    expect((await loadGalleryEdit(mockAdmin, G))!.cacheProgress).toBeNull();
  });
});

describe("T6.37 publish warm: marker and Prueba cover", () => {
  it("sets the cron marker so 'Fotos listas' counts warmed photos", async () => {
    await gallery();
    await photos(3);
    const { drive } = fakeDrive();
    await warmGalleryAtPublish(e, drive, G);
    const p = await warmProgress(e, G);
    expect(p.total).toBe(3);
    expect(p.warmed).toBe(3);
  });

  it("Prueba cover skips view-lg (same preview-wm file as view-sm)", async () => {
    await gallery({ mode: "proofing" });
    await photos(2);
    const { drive, calls } = fakeDrive();
    await warmGalleryAtPublish(e, drive, G);
    // thumb + view-sm of the cover, then straight on to the next photo.
    expect(calls.slice(0, 3)).toEqual(["WM-p000", "WM-p001"]);
  });
});
