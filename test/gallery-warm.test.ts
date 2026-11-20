import { clearCache } from "./support/cache";
import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, nowIso, schema } from "../app/db";
import { DriveError } from "../app/lib/server/drive-types";
import type { DriveClient } from "../app/lib/server/drive-types";
import {
  OPEN_WARM_BUDGET,
  OPEN_WARM_RATE,
  warmGalleryOnOpen,
} from "../app/lib/server/gallery-warm";
import { serveImage } from "../app/lib/server/images";
import { putSetting, SETTINGS_KEYS } from "../app/lib/server/settings";
import { warmCoverPhoto } from "../app/lib/server/warm";

const db = getDb(env);
const e = { ...env, DRIVE_MODE: "google" } as Env;
const JPEG = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const G = "gggggggg-0000-0000-0000-00000000000a";
const SLUG = "s-warm";

beforeAll(async () => {
  await migrateDb();
});

function fakeDrive(
  o: {
    cost?: number;
    fail?: Set<string>;
    gate?: Promise<void>;
  } = {},
) {
  let subs = 0;
  const calls: string[] = [];
  const drive = {
    subrequests: () => subs,
    async streamFile(id: string) {
      calls.push(id);
      subs += o.cost ?? 1;
      if (o.gate) await o.gate;
      if (o.fail?.has(id)) throw new DriveError(500, "x", "detail " + id);
      return new Response(JPEG.slice(), {
        headers: { "Content-Length": String(JPEG.length) },
      });
    },
  } as unknown as DriveClient;
  return { drive, calls };
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
const cached = async (id: string, v: string) =>
  (await env.CACHE.head(`${id}/${v}`)) !== null;

beforeEach(async () => {
  await db.delete(schema.galleries);
  await resetTables("settings", "rate_limits");
  await clearCache();
});

describe("T6.30 warmGalleryOnOpen", () => {
  it("warms thumb + view-sm of the first photos in grid order, within the Drive budget", async () => {
    await gallery();
    await photos(30);
    const { drive, calls } = fakeDrive();
    const r = await warmGalleryOnOpen(e, drive, SLUG);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThanOrEqual(OPEN_WARM_BUDGET);
    expect(r.stopped).toBe("budget");
    // grid order: p000 first, whole photos (thumb + view-sm), no view-lg yet
    expect(calls.slice(0, 2)).toEqual(["TH-p000", "WEB-p000"]);
    expect(calls.some((c) => c.startsWith("HI-"))).toBe(false);
    expect(await cached("p000", "thumb")).toBe(true);
    expect(await cached("p000", "view-sm")).toBe(true);
    expect(await cached("p029", "thumb")).toBe(false);
  });

  it("budgets by worst-case cost per call (expensive Drive calls stop early)", async () => {
    await gallery();
    await photos(30);
    const { drive, calls } = fakeDrive({ cost: 5 });
    await warmGalleryOnOpen(e, drive, SLUG);
    expect(calls.length * 5).toBeLessThanOrEqual(OPEN_WARM_BUDGET + 5);
    expect(drive.subrequests()).toBeLessThanOrEqual(OPEN_WARM_BUDGET);
  });

  it("repeated opens progress through the gallery (cursor), never refetching", async () => {
    await gallery();
    await photos(30);
    const all: string[] = [];
    for (let i = 0; i < 12; i++) {
      const { drive, calls } = fakeDrive();
      await warmGalleryOnOpen(e, drive, SLUG);
      all.push(...calls);
    }
    expect(new Set(all).size).toBe(all.length); // each file fetched once
    // thumb + view-sm of all 30 photos, then view-lg (phase two)
    for (let i = 0; i < 30; i++) {
      expect(await cached(pid(i), "thumb")).toBe(true);
      expect(await cached(pid(i), "view-sm")).toBe(true);
    }
    expect(all.filter((c) => c.startsWith("HI-")).length).toBeGreaterThan(0);
    // every thumb/web fetch precedes the first high-res fetch
    const firstHi = all.findIndex((c) => c.startsWith("HI-"));
    expect(all.slice(firstHi).some((c) => !c.startsWith("HI-"))).toBe(false);
  });

  it("ends with view-lg cached and then costs nothing (idempotent)", async () => {
    await gallery();
    await photos(3);
    const a = fakeDrive();
    await warmGalleryOnOpen(e, a.drive, SLUG);
    expect(a.calls).toHaveLength(9);
    expect(await cached("p002", "view-lg")).toBe(true);
    const b = fakeDrive();
    const r = await warmGalleryOnOpen(e, b.drive, SLUG);
    expect(b.calls).toHaveLength(0);
    expect(r.skipped).toBe("done");
  });

  it("skips what R2 already holds without a Drive call (also with no cursor)", async () => {
    await gallery();
    await photos(2);
    await warmGalleryOnOpen(e, fakeDrive().drive, SLUG);
    await resetTables("settings"); // cursor lost
    const b = fakeDrive();
    await warmGalleryOnOpen(e, b.drive, SLUG);
    expect(b.calls).toHaveLength(0);
  });

  it("Prueba stores and fetches only watermarked files", async () => {
    await gallery({ mode: "proofing" });
    await photos(2);
    const { drive, calls } = fakeDrive();
    await warmGalleryOnOpen(e, drive, SLUG);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.startsWith("WM-"))).toBe(true);
    for (const v of ["thumb", "view-sm", "view-lg"]) {
      const h = await env.CACHE.head(`p000/${v}`);
      expect(h?.customMetadata?.fileId).toBe("WM-p000");
      expect(h?.customMetadata?.wm).toBe("1");
    }
  });

  it("Prueba photo without preview-wm stores nothing (no clean fallback)", async () => {
    await gallery({ mode: "proofing" });
    await photos(2, { driveWmId: null });
    const { drive, calls } = fakeDrive();
    await warmGalleryOnOpen(e, drive, SLUG);
    expect(calls).toHaveLength(0);
    expect((await env.CACHE.list()).objects).toHaveLength(0);
  });

  it("a failing Drive file stops the run, is not fetched again at once, and never throws", async () => {
    await gallery();
    await photos(5);
    const a = fakeDrive({ fail: new Set(["TH-p001"]) });
    await expect(warmGalleryOnOpen(e, a.drive, SLUG)).resolves.toBeDefined();
    expect(a.calls).toContain("TH-p001");
    expect(a.calls).not.toContain("TH-p002");
    expect(await cached("p001", "thumb")).toBe(false);
    const b = fakeDrive();
    await warmGalleryOnOpen(e, b.drive, SLUG);
    expect(b.calls).not.toContain("TH-p001");
    expect(b.calls[0]).toBe("TH-p002");
  });

  it("only runs for published, non-archived galleries; never for mock, unknown slug or during sync", async () => {
    await gallery({ status: "draft" });
    await photos(2);
    const a = fakeDrive();
    await warmGalleryOnOpen(e, a.drive, SLUG);
    await warmGalleryOnOpen(e, a.drive, "nope");
    await db.update(schema.galleries).set({ status: "archived" });
    await warmGalleryOnOpen(e, a.drive, SLUG);
    await db.update(schema.galleries).set({ status: "published" });
    expect(
      (
        await warmGalleryOnOpen(
          { ...env, DRIVE_MODE: "mock" } as Env,
          a.drive,
          SLUG,
        )
      ).skipped,
    ).toBe("mock");
    await putSetting(
      env,
      SETTINGS_KEYS.syncLock,
      `${nowIso(new Date(Date.now() + 60_000))}|x`,
    );
    expect((await warmGalleryOnOpen(e, a.drive, SLUG)).skipped).toBe(
      "sync_running",
    );
    expect(a.calls).toHaveLength(0);
  });

  it("does not leave a cursor behind when the gallery is deleted mid-run", async () => {
    await gallery();
    await photos(3);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { drive } = fakeDrive({ gate });
    const run = warmGalleryOnOpen(e, drive, SLUG);
    await new Promise((r) => setTimeout(r, 50));
    await db.delete(schema.photos);
    await db.delete(schema.galleries);
    open();
    await run;
    expect(
      (
        await env.DB.prepare(
          "SELECT key FROM settings WHERE key LIKE 'warm_cursor:%'",
        ).all()
      ).results,
    ).toHaveLength(0);
  });

  it("is rate limited per gallery", async () => {
    await gallery();
    await photos(30);
    for (let i = 0; i < OPEN_WARM_RATE.max; i++)
      expect(
        (await warmGalleryOnOpen(e, fakeDrive({ cost: 5 }).drive, SLUG))
          .skipped,
      ).toBeUndefined();
    const x = fakeDrive();
    const r = await warmGalleryOnOpen(e, x.drive, SLUG);
    expect(r.skipped).toBe("limited");
    expect(x.calls).toHaveLength(0);
  });

  it("concurrent opens of one gallery do not duplicate Drive fetches", async () => {
    await gallery();
    await photos(4);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { drive, calls } = fakeDrive({ gate });
    const runs = [
      warmGalleryOnOpen(e, drive, SLUG),
      warmGalleryOnOpen(e, drive, SLUG),
      warmGalleryOnOpen(e, drive, SLUG),
    ];
    await new Promise((r) => setTimeout(r, 50));
    open();
    await Promise.all(runs);
    expect(new Set(calls).size).toBe(calls.length);
  });

  it("shares an in-flight fill with a cover warm and with a visitor miss", async () => {
    await gallery();
    await photos(1);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { drive, calls } = fakeDrive({ gate });
    const warm = warmGalleryOnOpen(e, drive, SLUG);
    const cover = warmCoverPhoto(e, drive, G, "p000");
    await new Promise((r) => setTimeout(r, 50));
    const pending: Promise<unknown>[] = [];
    const visitor = serveImage(
      new Request("https://x.test/img/p000/thumb"),
      { photoId: "p000", variant: "thumb" },
      e,
      { waitUntil: (p: Promise<unknown>) => void pending.push(p) },
      { drive },
    );
    await new Promise((r) => setTimeout(r, 100)); // visitor is now waiting or blocked in Drive
    open();
    const res = await visitor;
    await Promise.all([warm, cover, ...pending]);
    expect(res.status).toBe(200);
    expect(calls.filter((c) => c === "TH-p000")).toHaveLength(1);
    expect(calls.filter((c) => c === "WEB-p000")).toHaveLength(1);
  });
});
