/**
 * Deleting a gallery deletes ALL data associated with it (owner decision, PLAN
 * 4 and 6); the only thing kept is the Drive folder id in `ignored_folders`
 * (+ when), so the next sync does not re-create the gallery.
 *
 * Order (each step is safe to repeat, so a failure anywhere is just retried):
 *  1. take the sync lock (a running sync would insert photos for a gallery that
 *     is going away; the delete simply refuses with "busy");
 *  2. MARK: archive + hide from the home page + write the tombstone. From here
 *     the public routes 404, the warm cron skips it (archived) and sync skips
 *     the folder, so nothing refills R2 or re-adds photos;
 *  3. R2 first: the ids in `settings.r2_pending_deletes` (photos sync already
 *     removed; their cache keys were still waiting) are flushed first. The
 *     list does not record which gallery they came from, so ALL of them are
 *     cleaned: they are orphans by definition (no photo row), and sync would
 *     delete them on its next run anyway. Then, for this gallery: the cache keys are `<photo id>/<variant>` (images.ts), so they
 *     are known from the photo rows; deleted in calls of <= 1000 keys. If the
 *     D1 step then fails, the keys are gone and the gallery is merely still
 *     marked: re-submitting finishes (or "Continuar eliminación" in the list) (the reverse order would orphan objects
 *     whose ids can no longer be found). Past `r2CallsMax` calls per request
 *     (Workers Free allows 50 subrequests) the cleaned photo rows are dropped
 *     and "continue" is returned: the admin re-submits;
 *  4. one atomic D1 batch deletes every row tied to the gallery.
 * Known limit: a request that already passed the access checks (a `/img`
 * cache fill, a warm run that started before the mark) can `put` an object
 * after the R2 delete; its key is `<photo id>/...` and the photo row is gone,
 * so it is an unreachable orphan (never served: the route 404s). Documented in
 * PLAN 6; it is not swept (no list calls).
 * Drive is never touched (the app only reads it) and neither is the studio logo.
 */
import { eq, sql } from "drizzle-orm";
import { getDb, nowIso, schema } from "../../db";
import { safeEqual } from "./auth";
import { shortMac } from "./crypto";
import {
  deleteSetting,
  getSetting,
  putSetting,
  SETTINGS_KEYS,
} from "./settings";

/** The variants stored in R2 per photo (key `<photo id>/<variant>`). */
const R2_VARIANTS = ["thumb", "view-sm", "view-lg"] as const;
const R2_DELETE_MAX_KEYS = 1000;
const PHOTOS_PER_R2_CALL = Math.floor(R2_DELETE_MAX_KEYS / R2_VARIANTS.length);
/** R2 delete calls per request: D1 + R2 calls share the 50-subrequest Workers Free limit. */
export const R2_CALLS_PER_REQUEST = 25;
const LOCK_MS = 5 * 60_000;

/**
 * Every table with rows tied to a gallery, with the statement that deletes
 * them (`?1` = gallery id). The guard test introspects the migrated schema
 * and fails if a table with a gallery/photo/visitor reference is missing here
 * or in EXEMPT_TABLES. Order: children before parents.
 */
const DELETE_STATEMENTS = {
  // Keys embed the gallery id (`pin:<ip>:<id>`, `pinG:<id>`, `dl:`, `img:`...);
  // `dlj:<jti>` counters carry no gallery id: found through the download rows,
  // so this must run before `downloads` is deleted.
  rate_limits: `DELETE FROM rate_limits WHERE instr(key, ?1) > 0
    OR key IN (SELECT 'dlj:' || token_id FROM downloads WHERE gallery_id = ?1 AND token_id IS NOT NULL)`,
  favorites: "DELETE FROM favorites WHERE gallery_id = ?1",
  downloads: "DELETE FROM downloads WHERE gallery_id = ?1",
  gallery_views: "DELETE FROM gallery_views WHERE gallery_id = ?1",
  visitors: "DELETE FROM visitors WHERE gallery_id = ?1",
  photos: "DELETE FROM photos WHERE gallery_id = ?1",
  galleries: "DELETE FROM galleries WHERE id = ?1",
} as const;

export const GALLERY_TABLES = Object.keys(DELETE_STATEMENTS);

/** Tables that are deliberately NOT emptied by a gallery deletion, with the reason. */
export const EXEMPT_TABLES: Record<string, string> = {
  settings:
    "Studio-wide configuration (Drive root, logo, tokens): not gallery data.",
  ignored_folders:
    "The tombstones themselves: only a Drive folder id and a date, kept on purpose.",
};

export type DeleteOutcome = "deleted" | "continue" | "busy" | "not_found";

export interface DeleteOptions {
  /** R2 delete calls allowed in this request (default R2_CALLS_PER_REQUEST). */
  r2CallsMax?: number;
}

async function takeSyncLock(env: Env): Promise<string | null> {
  const value = `${nowIso(new Date(Date.now() + LOCK_MS))}|${crypto.randomUUID()}`;
  const got = await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value < ?3",
  )
    .bind(SETTINGS_KEYS.syncLock, value, nowIso())
    .run();
  return got.meta.changes ? value : null;
}

async function releaseSyncLock(env: Env, value: string) {
  await env.DB.prepare("DELETE FROM settings WHERE key = ?1 AND value = ?2")
    .bind(SETTINGS_KEYS.syncLock, value)
    .run();
}

const chunk = <T>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) =>
    a.slice(i * n, (i + 1) * n),
  );

const r2Keys = (ids: string[]) =>
  ids.flatMap((id) => R2_VARIANTS.map((v) => `${id}/${v}`));

async function readPending(env: Env): Promise<string[]> {
  try {
    const v: unknown = JSON.parse(
      (await getSetting(env, SETTINGS_KEYS.r2PendingDeletes)) ?? "[]",
    );
    return Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === "string"))]
      : [];
  } catch {
    return [];
  }
}

export async function deleteGallery(
  env: Env,
  galleryId: string,
  opts: DeleteOptions = {},
): Promise<DeleteOutcome> {
  const lock = await takeSyncLock(env);
  if (!lock) return "busy";
  try {
    return await deleteLocked(env, galleryId, opts);
  } finally {
    await releaseSyncLock(env, lock);
  }
}

async function deleteLocked(
  env: Env,
  galleryId: string,
  { r2CallsMax = R2_CALLS_PER_REQUEST }: DeleteOptions,
): Promise<DeleteOutcome> {
  const db = getDb(env);
  const [g] = await db
    .select({ folder: schema.galleries.driveFolderId })
    .from(schema.galleries)
    .where(eq(schema.galleries.id, galleryId));
  if (!g) return "not_found";

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE galleries SET status = 'archived', show_on_home = 0, archived_by_sync = 0, archived_prev_status = NULL WHERE id = ?1",
    ).bind(galleryId),
    env.DB.prepare(
      "INSERT OR IGNORE INTO ignored_folders (drive_folder_id, deleted_at) VALUES (?1, ?2)",
    ).bind(g.folder, nowIso()),
  ]);

  let calls = Math.max(0, r2CallsMax);
  const pending = await readPending(env);
  if (pending.length) {
    const parts = chunk(pending, PHOTOS_PER_R2_CALL);
    const take = parts.slice(0, calls);
    for (const part of take) await env.CACHE.delete(r2Keys(part));
    calls -= take.length;
    if (take.length < parts.length) {
      await putSetting(
        env,
        SETTINGS_KEYS.r2PendingDeletes,
        JSON.stringify(parts.slice(take.length).flat()),
      );
      return "continue";
    }
    await deleteSetting(env, SETTINGS_KEYS.r2PendingDeletes);
  }

  const ids = (
    await db
      .select({ id: schema.photos.id })
      .from(schema.photos)
      .where(eq(schema.photos.galleryId, galleryId))
      .orderBy(schema.photos.id)
  ).map((p) => p.id);
  const parts = chunk(ids, PHOTOS_PER_R2_CALL);
  const now = parts.slice(0, calls);
  for (const part of now) await env.CACHE.delete(r2Keys(part));
  if (now.length < parts.length) {
    // Progress: drop the photo rows whose cache is already gone (same order as `ids`).
    const cleaned = now.reduce((n, p) => n + p.length, 0);
    if (cleaned > 0)
      await env.DB.prepare(
        "DELETE FROM photos WHERE id IN (SELECT id FROM photos WHERE gallery_id = ?1 ORDER BY id LIMIT ?2)",
      )
        .bind(galleryId, cleaned)
        .run();
    return "continue";
  }

  await env.DB.batch([
    ...Object.values(DELETE_STATEMENTS).map((s) =>
      env.DB.prepare(s).bind(galleryId),
    ),
    // Per-gallery rows in the (otherwise exempt) settings table.
    env.DB.prepare("DELETE FROM settings WHERE key = ?1").bind(
      SETTINGS_KEYS.warmCursorPrefix + galleryId,
    ),
  ]);
  return "deleted";
}

export interface IgnoredFolder {
  driveFolderId: string;
  deletedAt: string;
}

/**
 * Opaque, stable, non-reversible handle for a tombstoned folder: the browser
 * never sees the Drive id (CLAUDE.md), only this HMAC (SESSION_SECRET).
 */
export const folderHandle = (
  env: Pick<Env, "SESSION_SECRET">,
  driveFolderId: string,
) => shortMac(env.SESSION_SECRET, `ignored-folder:${driveFolderId}`);

/** Tombstoned folders whose deletion is complete (no gallery row left), newest first. */
export async function ignoredFolders(env: Env): Promise<IgnoredFolder[]> {
  const t = schema.ignoredFolders;
  return getDb(env)
    .select({ driveFolderId: t.driveFolderId, deletedAt: t.deletedAt })
    .from(t)
    .where(
      sql`NOT EXISTS (SELECT 1 FROM galleries WHERE galleries.drive_folder_id = ${t.driveFolderId})`,
    )
    .orderBy(sql`${t.deletedAt} DESC`, t.driveFolderId);
}

/** Every tombstoned folder id, including deletions still in progress (sync skips all of them). */
export async function ignoredFolderIds(env: Env): Promise<Set<string>> {
  const rows = await getDb(env)
    .select({ id: schema.ignoredFolders.driveFolderId })
    .from(schema.ignoredFolders);
  return new Set(rows.map((r) => r.id));
}

/** Resolve a handle to its tombstoned folder id (every candidate compared in constant time); undefined = unknown. */
async function folderForHandle(
  env: Env,
  handle: string,
): Promise<string | undefined> {
  let found: string | undefined;
  for (const f of await ignoredFolders(env))
    if (safeEqual(await folderHandle(env, f.driveFolderId), handle))
      found = f.driveFolderId;
  return found;
}

/** "Volver a incluir" as the browser asks for it: by opaque handle. False (no-op) for an unknown handle. */
export async function reincludeByHandle(
  env: Env,
  handle: string,
): Promise<boolean> {
  const folder = await folderForHandle(env, handle);
  return folder !== undefined && (await reincludeFolder(env, folder));
}

/**
 * "Volver a incluir": forget a tombstone so the next sync re-creates the
 * gallery. The stored change token is cleared too: a non-forced sync with a
 * valid token only looks at what changed in Drive, and nothing has changed in
 * the folder, so it would never come back on its own. False when nothing was removed.
 */
export async function reincludeFolder(
  env: Env,
  driveFolderId: string,
): Promise<boolean> {
  const res = await env.DB.prepare(
    "DELETE FROM ignored_folders WHERE drive_folder_id = ?1 AND NOT EXISTS (SELECT 1 FROM galleries WHERE galleries.drive_folder_id = ignored_folders.drive_folder_id)",
  )
    .bind(driveFolderId)
    .run();
  if (res.meta.changes === 0) return false;
  await deleteSetting(env, SETTINGS_KEYS.driveChangesToken);
  return true;
}

/** True while a gallery is being deleted (tombstoned but its row still exists). */
export async function isDeleting(
  env: Env,
  driveFolderId: string,
): Promise<boolean> {
  const [r] = await getDb(env)
    .select({ id: schema.ignoredFolders.driveFolderId })
    .from(schema.ignoredFolders)
    .where(eq(schema.ignoredFolders.driveFolderId, driveFolderId));
  return !!r;
}
