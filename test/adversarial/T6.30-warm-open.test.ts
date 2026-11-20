import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, nowIso, schema } from "../../app/db";
import type { DriveClient } from "../../app/lib/server/drive-types";
import { warmGalleryOnOpen } from "../../app/lib/server/gallery-warm";
import { fillCacheShared } from "../../app/lib/server/images";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "google" } as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const G = "gggggggg-0000-0000-0000-00000000000b";
const SLUG = "s-adv";

beforeAll(async () => {
  await migrateDb();
});

function fakeDrive(gate?: Promise<void>) {
  let subs = 0;
  const calls: string[] = [];
  const drive = {
    subrequests: () => subs,
    async streamFile(id: string) {
      calls.push(id);
      subs += 1;
      if (gate) await gate;
      return new Response(JPEG.slice(), {
        headers: { "Content-Length": String(JPEG.length) },
      });
    },
  } as unknown as DriveClient;
  return { drive, calls };
}

const pid = (i: number) => `a${String(i).padStart(3, "0")}`;
const versions = (n = "1") =>
  JSON.stringify({
    highres: `2026-01-01T00:00:0${n}Z`,
    web: `2026-01-01T00:00:0${n}Z`,
    thumb: `2026-01-01T00:00:0${n}Z`,
    wm: `2026-01-01T00:00:0${n}Z`,
  });

async function seed(n: number, gOver: Record<string, unknown> = {}) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "folder-adv",
    slug: SLUG,
    title: "T",
    status: "published",
    ...gOver,
  });
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
      variantVersions: versions(),
      width: 300,
      height: 200,
    });
  }
}

beforeEach(async () => {
  await db.delete(schema.galleries);
  await resetTables("settings", "rate_limits");
  await clearCache();
});

describe("T6.30 adversarial", () => {
  it("never warms an expired gallery (defence in depth: loader race at the expiry instant)", async () => {
    await seed(2, { expiresAt: nowIso(new Date(Date.now() - 1000)) });
    const { drive, calls } = fakeDrive();
    const r = await warmGalleryOnOpen(e, drive, SLUG);
    expect(calls).toHaveLength(0);
    expect(r.skipped).toBe("unavailable");
  });

  it("a fill joined by a newer source version must not leave the stale object as the 'filled' result", async () => {
    await seed(1);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { drive } = fakeDrive(gate);
    const [row] = await db.select().from(schema.photos);
    const v1 = { ...row, proofing: false };
    // photo re-exported (new version) while the first fill is still streaming
    const v2 = { ...row, variantVersions: versions("9"), proofing: false };
    const a = fillCacheShared(e, v1, "view-sm", drive);
    const b = fillCacheShared(e, v2, "view-sm", drive);
    open();
    await Promise.all([a, b]);
    const head = await env.CACHE.head(`${pid(0)}/view-sm`);
    // the warm that holds v2 reported success, but R2 holds v1 (invalid for v2)
    expect(head?.customMetadata?.v).toBe("2026-01-01T00:00:09Z");
  });

  it("cursor survives a soft-missing photo without skipping a visible one", async () => {
    await seed(30);
    // first run stops on the budget part-way
    await warmGalleryOnOpen(e, fakeDrive().drive, SLUG);
    // first photo goes missing (no warm_stamp trigger fires for missing_since)
    await db
      .update(schema.photos)
      .set({ missingSince: nowIso() })
      .where((await import("drizzle-orm")).eq(schema.photos.id, pid(0)));
    for (let i = 0; i < 20; i++) {
      await resetTables("rate_limits");
      await warmGalleryOnOpen(e, fakeDrive().drive, SLUG);
    }
    const missing: string[] = [];
    for (let i = 1; i < 30; i++)
      if (!(await env.CACHE.head(`${pid(i)}/thumb`))) missing.push(pid(i));
    expect(missing).toEqual([]);
  });

  it("Prueba does not fetch the same preview-wm bytes twice (view-sm and view-lg are one file)", async () => {
    await seed(2, { mode: "proofing" });
    const all: string[] = [];
    for (let i = 0; i < 6; i++) {
      await resetTables("rate_limits");
      const { drive, calls } = fakeDrive();
      await warmGalleryOnOpen(e, drive, SLUG);
      all.push(...calls);
    }
    expect(new Set(all).size).toBe(all.length);
  });
});
