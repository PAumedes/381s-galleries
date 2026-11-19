import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { es } from "../app/i18n/es";
import { en } from "../app/i18n/en";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { runSync } from "../app/lib/server/sync";
import { insertViewOnce } from "../app/lib/server/gallery";
import {
  galleryAction,
  listGalleries,
} from "../app/lib/server/admin-galleries";
import {
  deleteGallery,
  folderHandle,
  ignoredFolders,
} from "../app/lib/server/gallery-delete";
import { setupAction, setupData } from "../app/routes/admin.setup";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const G = "eeeeeeee-0000-4000-8000-000000000001";
const H = "eeeeeeee-0000-4000-8000-000000000002";
const FOLDER = "drive-folder-secret-eee1";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await env.DB.batch(
    [
      "favorites",
      "downloads",
      "gallery_views",
      "visitors",
      "photos",
      "galleries",
      "rate_limits",
      "ignored_folders",
      "settings",
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  for (const o of (await env.CACHE.list()).objects)
    await env.CACHE.delete(o.key);
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: FOLDER,
    slug: "boda-ana",
    title: "Boda Ana",
    status: "published",
  });
  await db
    .insert(schema.photos)
    .values({ id: "p-g", galleryId: G, baseName: "A", driveHighresId: "h1" });
});

let failing = true;
const flakyCache = {
  ...env.CACHE,
  delete: async (k: string | string[]) => {
    if (failing) throw new Error("R2 down");
    return env.CACHE.delete(k);
  },
} as unknown as R2Bucket;
const SETUP = "http://localhost/admin/setup";
const sPost = (f: Record<string, string>) =>
  new Request(SETUP, { method: "POST", body: new URLSearchParams(f) });

describe("opaque handle for ignored folders", () => {
  it("setupData carries a handle and the date, never the folder id", async () => {
    await deleteGallery(e, G);
    const d = await setupData(new Request(SETUP), e);
    expect(d.ignoredFolders).toHaveLength(1);
    expect(Object.keys(d.ignoredFolders[0]).sort()).toEqual([
      "deletedAt",
      "handle",
    ]);
    expect(d.ignoredFolders[0].handle).toBe(await folderHandle(e, FOLDER));
    expect(JSON.stringify(d)).not.toContain(FOLDER);
  });
  it("the handle depends on the secret", async () => {
    expect(await folderHandle(e, FOLDER)).not.toBe(
      await folderHandle(
        {
          ...e,
          SESSION_SECRET: "other-secret-xxxxxxxxxxxxxxxxxxxxxxxx",
        } as Env,
        FOLDER,
      ),
    );
  });
  it("re-including by handle works; the raw folder id is not accepted", async () => {
    await deleteGallery(e, G);
    const raw = await setupAction(
      sPost({ intent: "reinclude", folder: FOLDER, confirm: "1" }),
      e,
    );
    expect(raw.ok).toBe(false);
    const bad = await setupAction(
      sPost({ intent: "reinclude", handle: FOLDER, confirm: "1" }),
      e,
    );
    expect(bad.ok).toBe(false);
    expect(await ignoredFolders(e)).toHaveLength(1);
    const ok = await setupAction(
      sPost({
        intent: "reinclude",
        handle: await folderHandle(e, FOLDER),
        confirm: "1",
      }),
      e,
    );
    expect(ok.ok).toBe(true);
    expect(await ignoredFolders(e)).toEqual([]);
  });
});

describe("failed deletion is handled and resumable", () => {
  const run = (envx: Env) =>
    galleryAction(
      new Request(`http://localhost/admin/g/${G}`, {
        method: "POST",
        body: new URLSearchParams({ intent: "delete", slug: "boda-ana" }),
      }),
      envx,
      G,
    ).then(
      (v) => v,
      (x) => x as Response,
    );
  it("an R2 failure returns deleteFailed; a retry completes the deletion", async () => {
    failing = true;
    const r = (await run({ ...e, CACHE: flakyCache } as Env)) as {
      ok: boolean;
      error: string;
    };
    expect(r.ok).toBe(false);
    expect(r.error).toBe(es["admin.msg.deleteFailed"]);
    const [row] = await listGalleries(e, "todas");
    expect(row.id).toBe(G);
    expect(row.deleting).toBe(true);
    failing = false;
    const done = (await run({ ...e, CACHE: flakyCache } as Env)) as Response;
    expect(done.status).toBe(303);
    expect(await listGalleries(e, "todas")).toEqual([]);
  });
  it("es and en both have the new keys", () => {
    for (const k of [
      "admin.msg.deleteFailed",
      "admin.list.deleting",
    ] as const) {
      expect(es[k]).toBeTruthy();
      expect(en[k]).toBeTruthy();
    }
  });
});

describe("pending R2 deletes of sync-removed photos", () => {
  it("are removed from the cache and from the pending list; other settings stay", async () => {
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('r2_pending_deletes', ?1)",
    )
      .bind(JSON.stringify(["gone-1", "gone-2"]))
      .run();
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('keep_me', 'x')",
    ).run();
    for (const id of ["gone-1", "gone-2"])
      for (const v of ["thumb", "view-sm", "view-lg"])
        await env.CACHE.put(`${id}/${v}`, "x");
    expect(await deleteGallery(e, G)).toBe("deleted");
    expect((await env.CACHE.list()).objects).toEqual([]);
    const rows = await env.DB.prepare(
      "SELECT key FROM settings WHERE key IN ('r2_pending_deletes','keep_me')",
    ).all<{ key: string }>();
    expect(rows.results.map((r) => r.key)).toEqual(["keep_me"]);
  });
  it("a pending list that cannot be flushed stays pending and the delete fails (retry later)", async () => {
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('r2_pending_deletes', ?1)",
    )
      .bind(JSON.stringify(["gone-1"]))
      .run();
    failing = true;
    await expect(
      deleteGallery({ ...e, CACHE: flakyCache } as Env, G),
    ).rejects.toThrow();
    const r = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'r2_pending_deletes'",
    ).first<{ value: string }>();
    expect(JSON.parse(r!.value)).toEqual(["gone-1"]);
  });
});

describe("re-including clears the change token", () => {
  it("is gone after 'Volver a incluir'", async () => {
    await runSync(e, { drive: createMockDrive() });
    const token = await env.DB.prepare(
      "SELECT 1 AS x FROM settings WHERE key = 'drive_changes_token'",
    ).first();
    expect(token).not.toBeNull();
    const g = (await db.select().from(schema.galleries))[0]!;
    await deleteGallery(e, g.id);
    await setupAction(
      sPost({
        intent: "reinclude",
        handle: await folderHandle(e, g.driveFolderId),
        confirm: "1",
      }),
      e,
    );
    expect(
      await env.DB.prepare(
        "SELECT 1 AS x FROM settings WHERE key = 'drive_changes_token'",
      ).first(),
    ).toBeNull();
  });
});

describe("re-including then the cron (non-forced) sync", () => {
  it("re-creates the gallery from Drive without any change in Drive", async () => {
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const g = (await db.select().from(schema.galleries)).find(
      (x) => x.id !== G,
    )!;
    expect(await deleteGallery(e, g.id)).toBe("deleted");
    await runSync(e, { drive: d }); // tombstoned: skipped
    expect(
      (await db.select().from(schema.galleries)).some(
        (x) => x.driveFolderId === g.driveFolderId,
      ),
    ).toBe(false);
    const r = await setupAction(
      sPost({
        intent: "reinclude",
        handle: await folderHandle(e, g.driveFolderId),
        confirm: "1",
      }),
      e,
    );
    expect(r.ok).toBe(true);
    await runSync(e, { drive: d }); // next scheduled sync, nothing changed in Drive
    expect(
      (await db.select().from(schema.galleries)).some(
        (x) => x.driveFolderId === g.driveFolderId,
      ),
    ).toBe(true);
  });
});

describe("view insert racing a delete", () => {
  const row = {
    galleryId: G,
    visitorId: null,
    ipHash: "abc",
  } as unknown as Parameters<typeof insertViewOnce>[1];
  it("inserts for an existing gallery", async () => {
    await insertViewOnce(e, row);
    expect((await db.select().from(schema.galleryViews)).length).toBe(1);
  });
  it("leaves no orphan row when the gallery is gone", async () => {
    await insertViewOnce(e, { ...row, galleryId: H });
    expect(await db.select().from(schema.galleryViews)).toEqual([]);
  });
});
