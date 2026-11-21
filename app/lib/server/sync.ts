/**
 * Drive -> D1 sync engine (PLAN §5.1). Read-only against Drive.
 *
 * Scans breadth-first with listChildrenMany (root -> albums -> recipe folders
 * -> set folders) so a whole library costs a handful of subrequests, computes
 * the desired state in memory, and only then writes (one D1 batch per
 * gallery). A budget overrun therefore aborts before any write.
 */
import { IMAGE_VARIANTS } from "../constants";
import { D1_BATCH_MAX, D1_IN_CHUNK, PHOTO_INSERT_ROWS } from "./d1-limits";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { getDb, nowIso, schema } from "../../db";
import {
  capIssues,
  chunk,
  cmp,
  issueCmp,
  keyOf,
  nfc,
  parsePending,
  parseFolderDate,
} from "./sync-helpers";
import type { AlbumDraft, PhotoDraft } from "./sync-helpers";
export { parseFolderDate } from "./sync-helpers";
export type { IssueType, SyncIssue } from "./sync-helpers";
import { makeGuard, scan, SyncBudgetError } from "./sync-scan";
import type { Guard } from "./sync-scan";
export { SyncBudgetError } from "./sync-scan";
import { ignoredFolderIds } from "./gallery-delete";
import { getRootFolderId } from "./drive-factory";
import { DriveError } from "./drive-types";
import type { DriveClient } from "./drive-types";
import * as settings from "./settings";
import { SETTINGS_KEYS } from "./settings";
import { uniqueSlug } from "./slug";

const LOCK_KEY = SETTINGS_KEYS.syncLock;
const TOKEN_KEY = SETTINGS_KEYS.driveChangesToken;
const LOCK_MS = 5 * 60_000;
/** A photo/folder must be missing for longer than this before it is deleted/archived. */
export const SYNC_DELETE_GRACE_MS = 60 * 60_000;
const PENDING_DELETES_KEY = SETTINGS_KEYS.r2PendingDeletes;
const LAST_ERROR_KEY = SETTINGS_KEYS.syncLastError;
// ids are 36 chars; keep the JSON value well under D1's 100 KB statement limit.
const PENDING_DELETES_CAP = 2000;
/** Workers limit is 1000 subrequests to Cloudflare services (D1/R2/KV). */
const CF_SUBREQUEST_CAP = 900;
const R2_DELETE_MAX = 1000;

export interface SyncResult {
  skipped?: "unchanged" | "locked" | "no_root" | "empty_root";
  galleries: { created: number; updated: number; archived: number };
  photos: { added: number; updated: number; removed: number };
  issues: number;
  subrequests: number;
}

export interface SyncOptions {
  drive: DriveClient;
  force?: boolean;
  now?: Date;
  /** Max external (Drive + Google OAuth) subrequests for this run (Workers Free limit is 50). */
  budget?: number;
}

type SyncEnv = Pick<Env, "DB" | "CACHE" | "DRIVE_MODE">;

// ----------------------------------------------------------------- writing

type Db = ReturnType<typeof getDb>;
type Row = typeof schema.photos.$inferSelect;
type GalleryRow = typeof schema.galleries.$inferSelect;
type BatchItem = Parameters<Db["batch"]>[0][number];

const photoFields = (p: PhotoDraft) => ({
  setName: p.setName,
  baseName: p.baseName,
  driveHighresId: p.highres.id,
  driveWebId: p.web?.id ?? null,
  driveIgId: p.ig?.id ?? null,
  driveThumbId: p.thumb?.id ?? null,
  driveWmId: p.wm?.id ?? null,
  driveThumbWmId: p.thumbWm?.id ?? null,
  highresBytes: p.highres.size ?? null,
  variantVersions: JSON.stringify({
    highres: p.highres.modifiedTime,
    web: p.web?.modifiedTime ?? null,
    ig: p.ig?.modifiedTime ?? null,
    thumb: p.thumb?.modifiedTime ?? null,
    wm: p.wm?.modifiedTime ?? null,
    thumbWm: p.thumbWm?.modifiedTime ?? null,
  }),
  width: p.width,
  height: p.height,
  takenAt: p.highres.takenAt ?? null,
});

/** Count of ops against the Cloudflare-services subrequest pool (D1/R2). */
type Op = (n?: number) => void;

// Op-counting wrappers: every settings read/write is one D1 subrequest.
async function getSetting(env: SyncEnv, key: string, op: Op) {
  op();
  return settings.getSetting(env, key);
}

async function putSetting(env: SyncEnv, key: string, value: string, op: Op) {
  op();
  await settings.putSetting(env, key, value);
}

async function dropSetting(env: SyncEnv, key: string, op: Op) {
  op();
  await settings.deleteSetting(env, key);
}

/**
 * Deletes the known R2 keys of removed photos: ONE `delete(keys[])` call per
 * <=1000 keys (no list calls; each R2 call is a subrequest). The ids were
 * persisted in `r2_pending_deletes` in the same D1 batch that deleted their
 * rows, so a crash anywhere cannot orphan keys; ids that were cleaned are
 * removed from the list. Returns the ids still pending.
 */
async function flushR2(
  env: SyncEnv,
  op: Op,
  pending: string[],
): Promise<string[]> {
  const ids = [...new Set(pending)];
  if (ids.length === 0) return [];
  const perCall = Math.floor(R2_DELETE_MAX / IMAGE_VARIANTS.length);
  let done = 0;
  try {
    for (; done < ids.length; done += perCall) {
      op();
      await env.CACHE.delete(
        ids
          .slice(done, done + perCall)
          .flatMap((id) => IMAGE_VARIANTS.map((k) => `${id}/${k}`)),
      );
    }
  } catch {
    console.error("sync: cache cleanup failed");
    const rest = ids.slice(done);
    await putSetting(env, PENDING_DELETES_KEY, JSON.stringify(rest), op);
    return rest;
  }
  await dropSetting(env, PENDING_DELETES_KEY, op);
  return [];
}

/**
 * Lock (expiry-based; only an expired lock can be taken over).
 * The one timestamp that is not a bare ISO value: `<iso>|<uuid>` (expiry + owner token).
 */
const newLockValue = (now: Date) =>
  `${nowIso(new Date(now.getTime() + LOCK_MS))}|${crypto.randomUUID()}`;

async function acquireLock(
  env: SyncEnv,
  lockValue: string,
  now: Date,
): Promise<boolean> {
  const got = await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value < ?3",
  )
    .bind(LOCK_KEY, lockValue, nowIso(now))
    .run();
  return Boolean(got.meta.changes);
}

/** Releases only our own lock (the value carries the owner token). */
async function releaseLock(env: SyncEnv, lockValue: string): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE key = ?1 AND value = ?2")
    .bind(LOCK_KEY, lockValue)
    .run();
}

/** What every phase of one sync run needs (Introduce Parameter Object). */
interface SyncRun {
  env: SyncEnv;
  db: Db;
  drive: DriveClient;
  guard: Guard;
  op: Op;
  now: Date;
}

/**
 * Only photos that can still mature count: gallery not archived, folder
 * present in the last scan, and not in the (marks-frozen) highres_empty state.
 */
async function hasMaturingMissing({ db }: SyncRun): Promise<boolean> {
  const [missingPhoto] = await db
    .select({ id: schema.photos.id })
    .from(schema.photos)
    .innerJoin(
      schema.galleries,
      eq(schema.photos.galleryId, schema.galleries.id),
    )
    .where(
      and(
        isNotNull(schema.photos.missingSince),
        ne(schema.galleries.status, "archived"),
        sql`${schema.galleries.folderMissingSince} is null`,
        sql`coalesce(${schema.galleries.syncIssuesJson}, '') not like '%"highres_empty"%'`,
      ),
    )
    .limit(1);
  const [missingFolder] = await db
    .select({ id: schema.galleries.id })
    .from(schema.galleries)
    .where(
      and(
        isNotNull(schema.galleries.folderMissingSince),
        ne(schema.galleries.status, "archived"),
      ),
    )
    .limit(1);
  return Boolean(missingPhoto || missingFolder);
}

/**
 * Change detection; takes the next token BEFORE scanning. Unfinished grace
 * periods (missing photos/folders) force a rescan so they can mature even
 * when Drive itself reports no new changes.
 */
async function detectChanges(
  run: SyncRun,
  force: boolean,
): Promise<{ unchanged: true } | { unchanged: false; nextToken: string }> {
  const { env, drive, guard, op } = run;
  const stored = await getSetting(env, TOKEN_KEY, op);
  let nextToken: string | undefined;
  if (stored && !force) {
    op(2);
    if (!(await hasMaturingMissing(run))) {
      try {
        guard.reserve(1);
        const ch = await drive.listChanges(stored);
        guard.check();
        if (!ch.changed) return { unchanged: true };
        nextToken = ch.newStartPageToken;
      } catch (err) {
        // Only a stale/invalid token (400/404) means "rescan"; auth, quota
        // and server errors must surface instead of silently costing a rescan.
        if (!(
          err instanceof DriveError &&
          (err.status === 400 || err.status === 404)
        ))
          throw err;
      }
    }
  }
  if (nextToken === undefined) {
    guard.reserve(1);
    nextToken = await drive.getStartPageToken();
    guard.check();
  }
  return { unchanged: false, nextToken };
}

/**
 * Trade-off: a gallery is written as several D1 batches (<=100 statements
 * each; one atomic batch could exceed D1 limits for big galleries). Order:
 * gallery row, deletes, marks, updates, inserts, so any prefix that
 * committed before a failure is a consistent state, and the next run
 * (the changes token is stored only after success) just re-diffs.
 */
async function flushBatches(
  { db, op }: SyncRun,
  stmts: BatchItem[],
): Promise<void> {
  if (stmts.length === 0) return;
  for (const part of chunk(stmts, D1_BATCH_MAX)) {
    op();
    await db.batch(part as [BatchItem, ...BatchItem[]]);
  }
}

/** One chunked IN query per <=90 galleries instead of one select each. */
async function loadPhotoRows(
  { db, op }: SyncRun,
  albums: AlbumDraft[],
  byFolder: Map<string, GalleryRow>,
): Promise<Map<string, Row[]>> {
  const rowsByGallery = new Map<string, Row[]>();
  for (const ids of chunk(
    albums.flatMap((a) => byFolder.get(a.folder.id)?.id ?? []),
    D1_IN_CHUNK,
  )) {
    op();
    for (const r of await db
      .select()
      .from(schema.photos)
      .where(inArray(schema.photos.galleryId, ids))) {
      const l = rowsByGallery.get(r.galleryId) ?? [];
      l.push(r);
      rowsByGallery.set(r.galleryId, l);
    }
  }
  return rowsByGallery;
}

const graceElapsed = (now: Date, since: string | null) =>
  since !== null && now.getTime() - Date.parse(since) > SYNC_DELETE_GRACE_MS;

/**
 * Albums whose folder is gone: mark first, archive only after the grace
 * period (remembering the previous status), rows are always kept.
 * Returns how many galleries were archived by this run.
 */
async function archiveAbsent(
  run: SyncRun,
  existing: GalleryRow[],
  albums: AlbumDraft[],
  syncedAt: string,
): Promise<number> {
  const { db, now } = run;
  const present = new Set(albums.map((a) => a.folder.id));
  const absent = existing.filter((g) => !present.has(g.driveFolderId));
  const gstmts: BatchItem[] = [];
  const firstSeen = absent.filter((g) => g.folderMissingSince === null);
  for (const ids of chunk(
    firstSeen.map((g) => g.id),
    D1_IN_CHUNK,
  ))
    gstmts.push(
      db
        .update(schema.galleries)
        .set({ folderMissingSince: syncedAt })
        .where(inArray(schema.galleries.id, ids)),
    );
  const due = absent.filter(
    (g) => g.status !== "archived" && graceElapsed(now, g.folderMissingSince),
  );
  for (const prev of ["draft", "published"] as const)
    for (const ids of chunk(
      due.filter((g) => g.status === prev).map((g) => g.id),
      D1_IN_CHUNK,
    ))
      gstmts.push(
        db
          .update(schema.galleries)
          .set({
            status: "archived",
            showOnHome: false,
            archivedPrevStatus: prev,
            archivedBySync: true,
          })
          .where(inArray(schema.galleries.id, ids)),
      );
  await flushBatches(run, gstmts);
  return due.length;
}

/** State shared by the per-album steps of one reconcile pass. */
interface AlbumPass {
  result: SyncResult;
  syncedAt: string;
  takenSlugs: Set<string>;
  /** Removed photo ids whose R2 keys still need deleting (persisted with the row deletes). */
  pendingIds: string[];
}

/**
 * The gallery-row statement(s) for one album: an update of an existing
 * gallery (only when something changed, or it must come back from a missing /
 * sync-archived state) or the insert of a new one.
 */
function galleryStatements(
  { env, db }: SyncRun,
  { result, syncedAt, takenSlugs }: AlbumPass,
  a: AlbumDraft,
  ex: GalleryRow | undefined,
  galleryId: string,
  issuesJson: string,
): BatchItem[] {
  const stmts: BatchItem[] = [];
  if (ex) {
    // Only galleries sync itself archived come back when the folder does;
    // an admin-archived gallery stays archived.
    const restore =
      ex.archivedBySync && ex.status === "archived"
        ? (ex.archivedPrevStatus ?? "draft")
        : undefined;
    // The admin owns the gallery mode: sync never changes it for an
    // existing gallery (switching to proofing would silently disable a
    // client's downloads). Only new galleries get a default from the
    // presence of preview-wm. A proofing gallery that loses its
    // preview-wm files 404s (admin sees "falta preview-wm").
    const changed =
      ex.syncIssuesJson !== issuesJson ||
      ex.driveModifiedAt !== a.folder.modifiedTime ||
      restore !== undefined;
    if (changed) result.galleries.updated++;
    if (changed || ex.folderMissingSince !== null || ex.archivedBySync)
      stmts.push(
        db
          .update(schema.galleries)
          .set({
            syncIssuesJson: issuesJson,
            driveModifiedAt: a.folder.modifiedTime,
            lastSyncedAt: syncedAt,
            folderMissingSince: null,
            ...(ex.archivedBySync
              ? {
                  archivedBySync: false,
                  archivedPrevStatus: null,
                  ...(restore ? { status: restore } : {}),
                }
              : {}),
          })
          .where(eq(schema.galleries.id, ex.id)),
      );
  } else {
    result.galleries.created++;
    const full = nfc(a.folder.name);
    const { title, eventDate } = parseFolderDate(full);
    stmts.push(
      db.insert(schema.galleries).values({
        id: galleryId,
        driveFolderId: a.folder.id,
        slug: uniqueSlug(full, takenSlugs),
        title,
        eventDate,
        status: env.DRIVE_MODE === "mock" ? "published" : "draft",
        mode: a.hasWm ? "proofing" : "delivery",
        syncIssuesJson: issuesJson,
        driveModifiedAt: a.folder.modifiedTime,
        lastSyncedAt: syncedAt,
      }),
    );
  }
  return stmts;
}

/** New photos: capture time first (dated before undated), then name, then set. */
const freshOrder = (x: PhotoDraft, y: PhotoDraft) =>
  (x.highres.takenAt && y.highres.takenAt
    ? cmp(x.highres.takenAt, y.highres.takenAt)
    : x.highres.takenAt
      ? -1
      : y.highres.takenAt
        ? 1
        : 0) ||
  cmp(x.baseName, y.baseName) ||
  cmp(x.setName, y.setName);

/**
 * Diffs an album's photos against its rows: returns the new drafts, the
 * update statements, and the rows to delete (grace over) or mark missing.
 * Counts photos.updated as it goes.
 */
function diffPhotos(
  { db, now }: SyncRun,
  { result }: AlbumPass,
  a: AlbumDraft,
  rows: Row[],
) {
  const rowByKey = new Map(rows.map((r) => [keyOf(r.setName, r.baseName), r]));
  const wanted = new Set<string>();
  const fresh: PhotoDraft[] = [];
  const updates: BatchItem[] = [];
  for (const p of a.photos) {
    const k = keyOf(p.setName, p.baseName);
    wanted.add(k);
    const row = rowByKey.get(k);
    if (!row) {
      fresh.push(p);
      continue;
    }
    const f = photoFields(p);
    const differs = (Object.keys(f) as (keyof typeof f)[]).some(
      (c) => row[c] !== f[c],
    );
    if (differs) result.photos.updated++;
    if (differs || row.missingSince !== null)
      updates.push(
        db
          .update(schema.photos)
          .set({ ...f, missingSince: null })
          .where(eq(schema.photos.id, row.id)),
      );
  }
  const gone = rows.filter((r) => !wanted.has(keyOf(r.setName, r.baseName)));
  return {
    fresh,
    updates,
    toDelete: gone.filter((r) => graceElapsed(now, r.missingSince)),
    toMark: gone.filter((r) => r.missingSince === null),
  };
}

/**
 * The photo statements for one album, in the order that keeps every committed
 * prefix consistent: pending-R2 ids, deletes, marks, updates, inserts.
 */
function photoStatements(
  run: SyncRun,
  pass: AlbumPass,
  a: AlbumDraft,
  rows: Row[],
  galleryId: string,
): BatchItem[] {
  const { db } = run;
  const { result, syncedAt } = pass;
  const { fresh, updates, toDelete, toMark } = diffPhotos(run, pass, a, rows);
  const goneIds = toDelete.map((r) => r.id);
  result.photos.removed += goneIds.length;
  result.photos.added += fresh.length;
  const stmts: BatchItem[] = [];

  if (goneIds.length) {
    // Same batch as the row deletes: ids survive any later failure.
    pass.pendingIds = [...new Set([...pass.pendingIds, ...goneIds])].slice(
      -PENDING_DELETES_CAP,
    );
    const value = JSON.stringify(pass.pendingIds);
    stmts.push(
      db
        .insert(schema.settings)
        .values({ key: PENDING_DELETES_KEY, value })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value } }),
    );
  }
  for (const ids of chunk(goneIds, D1_IN_CHUNK))
    stmts.push(db.delete(schema.photos).where(inArray(schema.photos.id, ids)));
  for (const ids of chunk(
    toMark.map((r) => r.id),
    D1_IN_CHUNK,
  ))
    stmts.push(
      db
        .update(schema.photos)
        .set({ missingSince: syncedAt })
        .where(inArray(schema.photos.id, ids)),
    );
  stmts.push(...updates);
  fresh.sort(freshOrder);
  let sort = rows.reduce((m, r) => Math.max(m, r.sort), -1) + 1;
  // D1 allows 100 bound parameters per statement (d1-limits.ts); a photo row binds ~18.
  for (const part of chunk(fresh, PHOTO_INSERT_ROWS))
    stmts.push(
      db.insert(schema.photos).values(
        part.map((p) => ({
          id: crypto.randomUUID(),
          galleryId,
          ...photoFields(p),
          sort: sort++,
        })),
      ),
    );
  return stmts;
}

/** Writes one album: gallery row first, then (unless high-res is empty) its photo diff. */
async function syncAlbum(
  run: SyncRun,
  pass: AlbumPass,
  a: AlbumDraft,
  ex: GalleryRow | undefined,
  rows: Row[],
): Promise<void> {
  const galleryId = ex?.id ?? crypto.randomUUID();
  // High-res folder missing/renamed/empty while the gallery has photos:
  // most likely a transient state (e.g. Capture One re-export). Touch nothing.
  const highresEmpty = a.photos.length === 0 && rows.length > 0;
  if (highresEmpty) {
    a.issues.push({ type: "highres_empty", set: null, name: "high-res" });
    a.issues.sort(issueCmp);
  }
  const issuesJson = capIssues(a.issues);
  pass.result.issues += a.issues.length;
  const stmts = galleryStatements(run, pass, a, ex, galleryId, issuesJson);
  if (!highresEmpty)
    stmts.push(...photoStatements(run, pass, a, rows, galleryId));
  await flushBatches(run, stmts);
}

interface Library {
  albums: AlbumDraft[];
  allRows: GalleryRow[];
  existing: GalleryRow[];
}

const emptyResult = (): SyncResult => ({
  galleries: { created: 0, updated: 0, archived: 0 },
  photos: { added: 0, updated: 0, removed: 0 },
  issues: 0,
  subrequests: 0,
});

/**
 * Scans Drive and reads the gallery rows. Folders of deleted galleries
 * (tombstones, or a deletion still in progress) are invisible to sync: not
 * re-created, not updated, not "missing". `allRows` still includes them so
 * their slugs stay taken.
 */
async function loadLibrary(
  { env, db, drive, guard, op }: SyncRun,
  rootId: string,
): Promise<Library> {
  op();
  const ignored = await ignoredFolderIds(env as Env);
  const albums = (await scan(rootId, drive, guard)).filter(
    (a) => !ignored.has(a.folder.id),
  );
  op();
  const allRows = await db.select().from(schema.galleries);
  const existing = allRows.filter((g) => !ignored.has(g.driveFolderId));
  return { albums, allRows, existing };
}

/**
 * Writes the whole library diff: every album, then the absent folders.
 * Returns the removed photo ids whose R2 keys still need deleting.
 */
async function applyLibrary(
  run: SyncRun,
  result: SyncResult,
  { albums, allRows, existing }: Library,
  pending: string[],
): Promise<string[]> {
  const byFolder = new Map(existing.map((g) => [g.driveFolderId, g]));
  const syncedAt = nowIso(run.now);
  const pass: AlbumPass = {
    result,
    syncedAt,
    takenSlugs: new Set(allRows.map((g) => g.slug.toLowerCase())),
    pendingIds: pending,
  };
  const rowsByGallery = await loadPhotoRows(run, albums, byFolder);
  for (const a of albums) {
    const ex = byFolder.get(a.folder.id);
    const rows = ex ? (rowsByGallery.get(ex.id) ?? []) : [];
    await syncAlbum(run, pass, a, ex, rows);
  }
  result.galleries.archived = await archiveAbsent(
    run,
    existing,
    albums,
    syncedAt,
  );
  return pass.pendingIds;
}

export async function runSync(
  env: SyncEnv,
  opts: SyncOptions,
): Promise<SyncResult> {
  const { drive, force = false, budget = 45 } = opts;
  const now = opts.now ?? new Date();
  const result = emptyResult();
  const startSubs = drive.subrequests();
  const guard = makeGuard(drive, budget);
  const db = getDb(env as Env);
  let cfOps = 0;
  const op: Op = (n = 1) => {
    cfOps += n;
    if (cfOps > CF_SUBREQUEST_CAP) throw new SyncBudgetError();
  };
  const run: SyncRun = { env, db, drive, guard, op, now };

  const lockValue = newLockValue(now);
  if (!(await acquireLock(env, lockValue, now)))
    return { ...result, skipped: "locked" };
  op();

  try {
    // 1b. Retry R2 cleanups that failed on a previous run, first thing.
    let pending = parsePending(await getSetting(env, PENDING_DELETES_KEY, op));
    if (pending.length) pending = await flushR2(env, op, pending);

    const rootId = await getRootFolderId(env);
    if (!rootId) return { ...result, skipped: "no_root" };

    // 2. Change detection; take the next token BEFORE scanning.
    const detected = await detectChanges(run, force);
    if (detected.unchanged)
      return {
        ...result,
        skipped: "unchanged",
        subrequests: drive.subrequests() - startSubs,
      };
    const nextToken = detected.nextToken;

    // 3-4. Scan (no writes yet) and read the current galleries.
    const { albums, allRows, existing } = await loadLibrary(run, rootId);
    if (albums.length === 0 && existing.length > 0) {
      // A transient empty listing must never archive the library.
      console.error("sync: root listing is empty but galleries exist; aborted");
      return {
        ...result,
        skipped: "empty_root",
        subrequests: drive.subrequests() - startSubs,
      };
    }
    const pendingIds = await applyLibrary(
      run,
      result,
      { albums, allRows, existing },
      pending,
    );

    await putSetting(env, TOKEN_KEY, nextToken, op);

    await flushR2(env, op, pendingIds);
    result.subrequests = drive.subrequests() - startSubs;
    return result;
  } finally {
    await releaseLock(env, lockValue);
  }
}

/**
 * The one place that records a successful sync: runs `runSync` and, unless it
 * was skipped for lack of work done (locked / no root / empty root), clears `sync_last_error` and
 * stamps `sync_last_ok`. Used by the cron, the admin API and the setup button.
 */
export async function runRecordedSync(
  env: SyncEnv,
  opts: SyncOptions,
): Promise<SyncResult> {
  const r = await runSync(env, opts);
  if (!r.skipped || r.skipped === "unchanged") {
    const noop: Op = () => {};
    await dropSetting(env, LAST_ERROR_KEY, noop);
    await putSetting(env, SETTINGS_KEYS.syncLastOk, nowIso(), noop);
    // New/changed photos may need warming: end the warm cron's idle back-off.
    if (!r.skipped) await dropSetting(env, SETTINGS_KEYS.warmIdle, noop);
  }
  return r;
}

/**
 * Cron entry point: records a generic `sync_last_error` (cleared on success)
 * and rethrows so the Cron Trigger run shows as failed.
 */
export async function runScheduledSync(
  env: SyncEnv,
  drive: DriveClient,
): Promise<SyncResult> {
  const noop: Op = () => {};
  const record = async (message: string) => {
    try {
      await putSetting(
        env,
        LAST_ERROR_KEY,
        JSON.stringify({ at: nowIso(), message }),
        noop,
      );
    } catch {
      console.error("sync: could not record last error");
    }
  };
  try {
    const r = await runRecordedSync(env, { drive });
    if (r.skipped === "no_root") await record("no root folder configured");
    else if (r.skipped === "empty_root")
      await record("root folder listed empty");
    return r;
  } catch (err) {
    // Name only: messages may hold Drive ids.
    console.error(
      "scheduled sync failed",
      err instanceof Error ? err.name : "error",
    );
    await record(
      err instanceof SyncBudgetError ? "budget exceeded" : "sync failed",
    );
    throw err;
  }
}
