import { clearCache } from "./support/cache";
import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXEMPT_TABLES,
  GALLERY_TABLES,
  deleteGallery,
  ignoredFolders,
  reincludeFolder,
} from "../app/lib/server/gallery-delete";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { runSync } from "../app/lib/server/sync";
import { galleryBy, ROOT } from "./adversarial/T1.3-helpers";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const VARIANTS = ["thumb", "view-sm", "view-lg"];

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables(
    "photo_approvals",
    "favorites",
    "photo_approvals",
    "downloads",
    "gallery_views",
    "visitors",
    "photo_versions",
    "delivery_rounds",
    "photos",
    "galleries",
    "rate_limits",
    "settings",
    "ignored_folders",
  );
  await clearCache();
});

const sql = (s: string, ...b: unknown[]) => env.DB.prepare(s).bind(...b);
const count = async (table: string, where = "1=1", ...b: unknown[]) =>
  (await sql(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...b).first<{
    n: number;
  }>())!.n;

/** One row in EVERY table that references a gallery, for gallery `g`. */
const SEED: Record<string, (g: string, tag: string) => D1PreparedStatement[]> =
  {
    galleries: (g, tag) => [
      sql(
        "INSERT INTO galleries (id, drive_folder_id, slug, title, status, show_on_home) VALUES (?1, ?2, ?3, 'T', 'published', 1)",
        g,
        `folder-${tag}`,
        `slug-${tag}`,
      ),
    ],
    photos: (g, tag) => [
      sql(
        "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES (?1, ?2, 'IMG', 'hr')",
        `ph-${tag}`,
        g,
      ),
    ],
    delivery_rounds: (g, tag) => [
      sql(
        "INSERT INTO delivery_rounds (id, gallery_id, number) VALUES (?1, ?2, 1)",
        `r-${tag}`,
        g,
      ),
    ],
    photo_versions: (g, tag) => [
      sql(
        "INSERT INTO photo_versions (photo_id, gallery_id, version, round_id, drive_highres_id) VALUES (?1, ?3, 1, NULL, 'hr'), (?1, ?3, 2, ?2, 'hr2')",
        `ph-${tag}`,
        `r-${tag}`,
        g,
      ),
    ],
    visitors: (g, tag) => [
      sql(
        "INSERT INTO visitors (id, gallery_id, email) VALUES (?1, ?2, ?3)",
        `v-${tag}`,
        g,
        `${tag}@x.test`,
      ),
    ],
    photo_approvals: (g, tag) => [
      sql(
        "INSERT INTO photo_approvals (gallery_id, photo_id, version, visitor_id) VALUES (?1, ?2, 2, ?3)",
        g,
        `ph-${tag}`,
        `v-${tag}`,
      ),
    ],
    favorites: (g, tag) => [
      sql(
        "INSERT INTO favorites (gallery_id, visitor_id, photo_id) VALUES (?1, ?2, ?3)",
        g,
        `v-${tag}`,
        `ph-${tag}`,
      ),
    ],
    downloads: (g, tag) => [
      sql(
        "INSERT INTO downloads (id, gallery_id, photo_id, visitor_id, variant, kind, token_id, ip_hash, city) VALUES (?1, ?2, ?3, ?4, 'web', 'single', ?5, 'h', 'Rosario')",
        `d-${tag}`,
        g,
        `ph-${tag}`,
        `v-${tag}`,
        `jti-${tag}`,
      ),
    ],
    gallery_views: (g, tag) => [
      sql(
        "INSERT INTO gallery_views (gallery_id, visitor_id, ip_hash, city) VALUES (?1, ?2, 'h', 'Rosario')",
        g,
        `v-${tag}`,
      ),
    ],
    rate_limits: (g, tag) =>
      [
        `pin:iphash:${g}`,
        `pinG:${g}`,
        `visitor:iphash:${g}`,
        `anon:iphash:${g}`,
        `dl:iphash:${g}`,
        `dlget:iphash:${g}`,
        `img:iphash:${g}`,
        `dlj:jti-${tag}`,
      ].map((k) =>
        sql(
          "INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, '2026-01-01T00:00:00Z')",
          k,
        ),
      ),
  };

async function seed(g: string, tag: string) {
  const order = [
    "galleries",
    "photos",
    "delivery_rounds",
    "photo_versions",
    "visitors",
    "favorites",
    "photo_approvals",
    "downloads",
    "gallery_views",
    "rate_limits",
  ];
  for (const t of order) await env.DB.batch(SEED[t](g, tag));
  for (const v of VARIANTS) await env.CACHE.put(`ph-${tag}/${v}`, "x");
}

const snapshot = async () => {
  const out: Record<string, number> = {};
  for (const t of Object.keys(SEED)) out[t] = await count(t);
  return out;
};

describe("schema guard: every table tied to a gallery is deleted or exempt", () => {
  async function introspect(): Promise<string[]> {
    const tables = (
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name <> 'd1_migrations'",
      ).all<{ name: string }>()
    ).results.map((r) => r.name);
    const hit: string[] = [];
    for (const t of tables) {
      const cols = (
        await env.DB.prepare(`SELECT name FROM pragma_table_info('${t}')`).all<{
          name: string;
        }>()
      ).results.map((c) => c.name);
      const fks = (
        await env.DB.prepare(
          `SELECT "table" AS t FROM pragma_foreign_key_list('${t}')`,
        ).all<{ t: string }>()
      ).results.map((f) => f.t);
      if (
        t === "galleries" ||
        cols.some((c) =>
          ["gallery_id", "photo_id", "visitor_id"].includes(c),
        ) ||
        fks.some((f) => ["galleries", "photos", "visitors"].includes(f))
      )
        hit.push(t);
    }
    return hit;
  }

  it("covers every table with a gallery_id / photo_id / visitor_id column or an FK to galleries, photos or visitors", async () => {
    const found = await introspect();
    expect(found.length).toBeGreaterThanOrEqual(6);
    const known = new Set([...GALLERY_TABLES, ...Object.keys(EXEMPT_TABLES)]);
    expect(found.filter((t) => !known.has(t))).toEqual([]);
  });

  it("T6.53a: versions and rounds are deleted by explicit statements, not only by FK cascade", () => {
    expect(GALLERY_TABLES).toEqual(
      expect.arrayContaining(["photo_versions", "delivery_rounds"]),
    );
    expect(GALLERY_TABLES.indexOf("photo_versions")).toBeLessThan(
      GALLERY_TABLES.indexOf("photos"),
    );
    expect(GALLERY_TABLES.indexOf("delivery_rounds")).toBeLessThan(
      GALLERY_TABLES.indexOf("galleries"),
    );
  });

  it("T6.53f: approvals are deleted by an explicit statement before visitors and versions", () => {
    expect(GALLERY_TABLES).toContain("photo_approvals");
    for (const later of ["visitors", "photo_versions", "photos"])
      expect(GALLERY_TABLES.indexOf("photo_approvals")).toBeLessThan(
        GALLERY_TABLES.indexOf(later),
      );
  });

  it("every exempt table states a reason, and none is also deleted", () => {
    for (const [t, why] of Object.entries(EXEMPT_TABLES)) {
      expect(why.length).toBeGreaterThan(10);
      expect(GALLERY_TABLES).not.toContain(t);
    }
  });

  it("the seeding below has a row for every covered table", async () => {
    const found = await introspect();
    for (const t of found) {
      if (!Object.keys(EXEMPT_TABLES).includes(t))
        expect(Object.keys(SEED)).toContain(t);
    }
    for (const t of GALLERY_TABLES) expect(Object.keys(SEED)).toContain(t);
  });
});

describe("deleteGallery", () => {
  it("deletes every row of gallery A in every table and touches nothing of B or the global tables", async () => {
    await seed(A, "a");
    await seed(B, "b");
    await env.DB.batch([
      sql(
        "INSERT INTO settings (key, value) VALUES ('studio_name', 'Estudio')",
      ),
      sql(
        'INSERT INTO settings (key, value) VALUES (\'logo_on_light\', \'{"t":"png","v":"1"}\')',
      ),
      sql(
        "INSERT INTO rate_limits (key, count, window_start) VALUES ('pin:iphash:other-gallery', 1, '2026-01-01T00:00:00Z')",
      ),
    ]);
    await env.CACHE.put("brand/logo-on-light", "logo");
    await env.DB.batch([
      sql(
        "INSERT INTO settings (key, value) VALUES (?1, 'done:x')",
        `warm_cursor:${A}`,
      ),
      sql(
        "INSERT INTO settings (key, value) VALUES (?1, 'done:x')",
        `warm_cursor:${B}`,
      ),
    ]);
    const before = await snapshot();

    expect(await deleteGallery(e, A)).toBe("deleted");
    // T6.30: the warm-on-open cursor is gallery data
    expect(await count("settings", "key = ?1", `warm_cursor:${A}`)).toBe(0);
    expect(await count("settings", "key = ?1", `warm_cursor:${B}`)).toBe(1);

    for (const t of GALLERY_TABLES) {
      if (t === "rate_limits") continue;
      const col = t === "galleries" ? "id" : "gallery_id";
      // photo_versions: 2 rows per photo
      expect(await count(t, `${col} = ?1`, A), t).toBe(0);
      expect(await count(t, `${col} = ?1`, B), t).toBe(
        t === "photo_versions" ? 2 : 1,
      );
    }
    // rate limits: A's keys (any scope, including dlj: of its download tokens) are gone
    expect(await count("rate_limits", "instr(key, ?1) > 0", A)).toBe(0);
    expect(await count("rate_limits", "key = 'dlj:jti-a'")).toBe(0);
    expect(await count("rate_limits", "instr(key, ?1) > 0", B)).toBe(7);
    expect(await count("rate_limits", "key = 'dlj:jti-b'")).toBe(1);
    expect(await count("rate_limits", "key = 'pin:iphash:other-gallery'")).toBe(
      1,
    );
    // global data survives
    expect(
      await count("settings", "key IN ('studio_name', 'logo_on_light')"),
    ).toBe(2);
    expect(await env.CACHE.get("brand/logo-on-light")).not.toBeNull();
    // totals: exactly A's rows are missing
    const after = await snapshot();
    expect(before.galleries - after.galleries).toBe(1);
    expect(before.photos - after.photos).toBe(1);
    expect(before.visitors - after.visitors).toBe(1);
    expect(before.favorites - after.favorites).toBe(1);
    expect(before.downloads - after.downloads).toBe(1);
    expect(before.gallery_views - after.gallery_views).toBe(1);
    expect(before.rate_limits - after.rate_limits).toBe(8);
  });

  it("deletes the R2 cache objects of A's photos (all variants, also hidden photos) and nothing else", async () => {
    await seed(A, "a");
    await seed(B, "b");
    await sql(
      "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id, missing_since) VALUES ('ph-a2', ?1, 'IMG2', 'hr2', '2026-01-01T00:00:00Z')",
      A,
    ).run();
    for (const v of VARIANTS) await env.CACHE.put(`ph-a2/${v}`, "x");
    await deleteGallery(e, A);
    const left = (await env.CACHE.list()).objects.map((o) => o.key).sort();
    expect(left).toEqual(VARIANTS.map((v) => `ph-b/${v}`).sort());
  });

  it("deletes R2 objects BEFORE the D1 batch, in calls of at most 1000 keys", async () => {
    await seed(A, "a");
    const rows: D1PreparedStatement[] = [];
    for (let i = 0; i < 700; i++)
      rows.push(
        sql(
          "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES (?1, ?2, ?3, 'h')",
          `bulk-${i}`,
          A,
          `N${i}`,
        ),
      );
    for (let i = 0; i < rows.length; i += 50)
      await env.DB.batch(rows.slice(i, i + 50));
    const seen: { n: number; galleryRowThere: boolean }[] = [];
    const wrapped = new Proxy(env.CACHE, {
      get(t, k) {
        if (k === "delete")
          return async (keys: string | string[]) => {
            seen.push({
              n: Array.isArray(keys) ? keys.length : 1,
              galleryRowThere: (await count("galleries", "id = ?1", A)) === 1,
            });
            return t.delete(keys as string[]);
          };
        const v = (t as never)[k];
        return typeof v === "function" ? (v as () => unknown).bind(t) : v;
      },
    });
    expect(await deleteGallery({ ...e, CACHE: wrapped } as Env, A)).toBe(
      "deleted",
    );
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.every((s) => s.n <= 1000)).toBe(true);
    expect(seen.every((s) => s.galleryRowThere)).toBe(true);
    expect(await count("galleries", "id = ?1", A)).toBe(0);
  });

  it("is resumable: past the per-request R2 budget it hides the gallery, reports 'continue', and a re-submit finishes", async () => {
    await seed(A, "a");
    // seed() adds a v2 version row whose keys now take the first R2 call (T6.55): drop it to measure the photo budget alone
    await sql("DELETE FROM photo_versions WHERE gallery_id = ?1", A).run();
    const rows: D1PreparedStatement[] = [];
    for (let i = 0; i < 700; i++)
      rows.push(
        sql(
          "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES (?1, ?2, ?3, 'h')",
          `bulk-${i}`,
          A,
          `N${i}`,
        ),
      );
    for (let i = 0; i < rows.length; i += 50)
      await env.DB.batch(rows.slice(i, i + 50));
    for (let i = 0; i < 700; i++) await env.CACHE.put(`bulk-${i}/thumb`, "x");

    expect(await deleteGallery(e, A, { r2CallsMax: 1 })).toBe("continue");
    // hidden: archived, off the home page, still has its row; the folder is tombstoned
    const g = await sql(
      "SELECT status, show_on_home AS home FROM galleries WHERE id = ?1",
      A,
    ).first<{ status: string; home: number }>();
    expect(g).toEqual({ status: "archived", home: 0 });
    expect(await count("ignored_folders", "drive_folder_id = 'folder-a'")).toBe(
      1,
    );
    // exactly one R2 call of floor(1000 / 3) = 333 photos was spent (seed() adds one photo: 701)
    expect(await count("photos", "gallery_id = ?1", A)).toBe(701 - 333);
    // progress is kept: the re-submit does not start over
    expect(await deleteGallery(e, A, { r2CallsMax: 1 })).toBe("continue");
    expect(await count("photos", "gallery_id = ?1", A)).toBe(701 - 666);
    expect(await deleteGallery(e, A, { r2CallsMax: 1 })).toBe("deleted");
    expect(await count("galleries", "id = ?1", A)).toBe(0);
    expect((await env.CACHE.list()).objects).toHaveLength(0);
  });

  it("pending flush spends the same per-request R2 budget: an exhausted budget leaves the photos untouched and keeps only the unflushed pending ids", async () => {
    await seed(A, "a");
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 5; i++)
      stmts.push(
        sql(
          "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES (?1, ?2, ?3, 'h')",
          `ph-${i}`,
          A,
          `N${i}`,
        ),
      );
    await env.DB.batch(stmts);
    const pend = Array.from({ length: 700 }, (_, i) => `old-${i}`);
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('r2_pending_deletes', ?1)",
    )
      .bind(JSON.stringify(pend))
      .run();
    expect(await deleteGallery(e, A, { r2CallsMax: 1 })).toBe("continue");
    const left = async () =>
      JSON.parse(
        (await sql(
          "SELECT value FROM settings WHERE key = 'r2_pending_deletes'",
        ).first<{ value: string }>())!.value,
      ) as string[];
    expect(await left()).toEqual(pend.slice(333));
    // seed() adds one photo besides the 5 above
    expect(await count("photos", "gallery_id = ?1", A)).toBe(6);
  });

  it("a fully flushed pending list leaves only the REST of the budget for the photos", async () => {
    await seed(A, "a");
    // seed() adds a v2 version row whose keys now take the first R2 call (T6.55): drop it to measure the photo budget alone
    await sql("DELETE FROM photo_versions WHERE gallery_id = ?1", A).run();
    const rows: D1PreparedStatement[] = [];
    for (let i = 0; i < 700; i++)
      rows.push(
        sql(
          "INSERT INTO photos (id, gallery_id, base_name, drive_highres_id) VALUES (?1, ?2, ?3, 'h')",
          `bulk-${i}`,
          A,
          `N${i}`,
        ),
      );
    for (let i = 0; i < rows.length; i += 50)
      await env.DB.batch(rows.slice(i, i + 50));
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('r2_pending_deletes', ?1)",
    )
      .bind(JSON.stringify(["old-1", "old-2"]))
      .run();
    // budget 2: one call flushes the pending ids, one is left for 333 photos
    expect(await deleteGallery(e, A, { r2CallsMax: 2 })).toBe("continue");
    expect(await count("photos", "gallery_id = ?1", A)).toBe(701 - 333);
    expect(await count("settings", "key = 'r2_pending_deletes'")).toBe(0);
  });

  it("an R2 failure leaves the gallery intact (hidden, not half-deleted in D1) and a retry succeeds", async () => {
    await seed(A, "a");
    const broken = new Proxy(env.CACHE, {
      get(t, k) {
        if (k === "delete") return () => Promise.reject(new Error("r2 down"));
        const v = (t as never)[k];
        return typeof v === "function" ? (v as () => unknown).bind(t) : v;
      },
    });
    await expect(
      deleteGallery({ ...e, CACHE: broken } as Env, A),
    ).rejects.toThrow();
    expect(await count("photos", "gallery_id = ?1", A)).toBe(1);
    expect(await count("favorites", "gallery_id = ?1", A)).toBe(1);
    // the sync lock does not stay taken
    expect(await count("settings", "key = 'sync_lock'")).toBe(0);
    expect(await deleteGallery(e, A)).toBe("deleted");
  });

  it("a double submit is idempotent: the second call is not_found and changes nothing", async () => {
    await seed(A, "a");
    await seed(B, "b");
    expect(await deleteGallery(e, A)).toBe("deleted");
    const snap = await snapshot();
    expect(await deleteGallery(e, A)).toBe("not_found");
    expect(await snapshot()).toEqual(snap);
    expect(await deleteGallery(e, "no-such-gallery")).toBe("not_found");
  });

  it("refuses while a sync holds the lock, deleting nothing; the lock is released afterwards", async () => {
    await seed(A, "a");
    const future = new Date(Date.now() + 60_000)
      .toISOString()
      .replace(/\.\d+Z$/, "Z");
    await sql(
      "INSERT INTO settings (key, value) VALUES ('sync_lock', ?1)",
      `${future}|owner`,
    ).run();
    expect(await deleteGallery(e, A)).toBe("busy");
    expect(await count("galleries", "id = ?1", A)).toBe(1);
    expect(await count("photos", "gallery_id = ?1", A)).toBe(1);
    expect(await count("ignored_folders")).toBe(0);
    expect(
      (await sql("SELECT value FROM settings WHERE key = 'sync_lock'").first<{
        value: string;
      }>())!.value,
    ).toBe(`${future}|owner`);
    await sql("DELETE FROM settings WHERE key = 'sync_lock'").run();
    expect(await deleteGallery(e, A)).toBe("deleted");
    expect(await count("settings", "key = 'sync_lock'")).toBe(0);
  });

  it("keeps only the Drive folder id and the deletion time (no title, slug, or visitor data)", async () => {
    await seed(A, "a");
    await deleteGallery(e, A);
    const cols = (
      await env.DB.prepare(
        "SELECT name FROM pragma_table_info('ignored_folders')",
      ).all<{ name: string }>()
    ).results.map((c) => c.name);
    expect(cols.sort()).toEqual(["deleted_at", "drive_folder_id"]);
    const list = await ignoredFolders(e);
    expect(list).toHaveLength(1);
    expect(list[0].driveFolderId).toBe("folder-a");
    expect(list[0].deletedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });
});

describe("tombstones and sync", () => {
  it("sync does not re-create a deleted gallery; re-including the folder brings it back from scratch", async () => {
    await sql(
      "INSERT INTO settings (key, value) VALUES ('drive_root_id', ?1)",
      ROOT(),
    ).run();
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const g = await galleryBy("retrato-sofia");
    expect(g).toBeTruthy();
    expect(await deleteGallery(e, g.id)).toBe("deleted");
    expect(await galleryBy("retrato-sofia")).toBeUndefined();

    await runSync(e, { drive: d, force: true });
    expect(await galleryBy("retrato-sofia")).toBeUndefined();
    expect(await count("photos", "gallery_id = ?1", g.id)).toBe(0);
    // the other galleries are unaffected
    expect(await count("galleries")).toBeGreaterThan(0);

    const [t] = await ignoredFolders(e);
    expect(t.driveFolderId).toBe(g.driveFolderId);
    expect(await reincludeFolder(e, t.driveFolderId)).toBe(true);
    expect(await ignoredFolders(e)).toEqual([]);
    await runSync(e, { drive: d, force: true });
    const again = await galleryBy("retrato-sofia");
    expect(again).toBeTruthy();
    expect(again.id).not.toBe(g.id);
  });

  it("a half-deleted gallery is left alone by sync (no photos re-added, not archived-by-sync, no empty_root abort)", async () => {
    await sql(
      "INSERT INTO settings (key, value) VALUES ('drive_root_id', ?1)",
      ROOT(),
    ).run();
    const d = createMockDrive();
    await runSync(e, { drive: d });
    const g = await galleryBy("retrato-sofia");
    await env.CACHE.put(
      `${(await sql("SELECT id FROM photos WHERE gallery_id = ?1 LIMIT 1", g.id).first<{ id: string }>())!.id}/thumb`,
      "x",
    );
    expect(await deleteGallery(e, g.id, { r2CallsMax: 0 })).toBe("continue");
    const photosBefore = await count("photos", "gallery_id = ?1", g.id);
    await runSync(e, { drive: d, force: true });
    expect(await count("photos", "gallery_id = ?1", g.id)).toBe(photosBefore);
    const row = await galleryBy("retrato-sofia");
    expect(row.status).toBe("archived");
    expect(row.archivedBySync).toBe(false);
    expect(await deleteGallery(e, g.id)).toBe("deleted");
  });

  it("re-including is a no-op for a folder whose gallery is still being deleted", async () => {
    await seed(A, "a");
    expect(await deleteGallery(e, A, { r2CallsMax: 0 })).toBe("continue");
    expect(await ignoredFolders(e)).toEqual([]); // not listed yet
    expect(await reincludeFolder(e, "folder-a")).toBe(false);
    expect(await count("ignored_folders")).toBe(1);
  });

  it("logs nothing with raw ids (no console output carries a gallery id)", async () => {
    const spy = vi.spyOn(console, "error");
    const log = vi.spyOn(console, "log");
    await seed(A, "a");
    await deleteGallery(e, A);
    const out = JSON.stringify([...spy.mock.calls, ...log.mock.calls]);
    expect(out).not.toContain(A);
    spy.mockRestore();
    log.mockRestore();
  });
});
