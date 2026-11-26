/**
 * Drive -> D1 sync engine (PLAN §5.1). Read-only against Drive.
 *
 * Scans breadth-first with listChildrenMany (root -> albums -> recipe folders
 * -> set folders) so a whole library costs a handful of subrequests, computes
 * the desired state in memory, and only then writes (one D1 batch per
 * gallery). A budget overrun therefore aborts before any write.
 */
import { and, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { getDb, nowIso, schema } from "../../db";
import { parsePending } from "./sync-helpers";
import type { AlbumDraft } from "./sync-helpers";
export { parseFolderDate } from "./sync-helpers";
export type { IssueType, SyncIssue } from "./sync-helpers";
import { makeGuard, scan, SyncBudgetError } from "./sync-scan";
export { SyncBudgetError } from "./sync-scan";
export { SYNC_DELETE_GRACE_MS } from "./sync-types";
export type { SyncResult } from "./sync-types";
import {
  acquireLock,
  dropSetting,
  flushR2,
  getSetting,
  LAST_ERROR_KEY,
  newLockValue,
  PENDING_DELETES_KEY,
  putSetting,
  releaseLock,
  TOKEN_KEY,
} from "./sync-state";
import { archiveAbsent, loadPhotoRows } from "./sync-archive";
import { syncAlbum } from "./sync-album";
import { loadVersionState } from "./sync-version-rows";
import type { AlbumPass } from "./sync-album";
import type {
  GalleryRow,
  Op,
  SyncEnv,
  SyncResult,
  SyncRun,
} from "./sync-types";
import { clientSlugs } from "./slug-namespace";
import { ignoredFolderIds } from "./gallery-delete";
import { getRootFolderId } from "./drive-factory";
import { DriveError } from "./drive-types";
import type { DriveClient } from "./drive-types";
import { SETTINGS_KEYS } from "./settings";

const CF_SUBREQUEST_CAP = 900;
/** Workers limit is 1000 subrequests to Cloudflare services (D1/R2/KV). */

export interface SyncOptions {
  drive: DriveClient;
  force?: boolean;
  now?: Date;
  /** Max external (Drive + Google OAuth) subrequests for this run (Workers Free limit is 50). */
  budget?: number;
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
      or(
        and(
          isNotNull(schema.photos.missingSince),
          ne(schema.galleries.status, "archived"),
          sql`${schema.galleries.folderMissingSince} is null`,
          sql`coalesce(${schema.galleries.syncIssuesJson}, '') not like '%"highres_empty"%'`,
        ),
        // A version row marked missing (T6.53b) matures like a photo. Folded
        // into this query (the join always has rows when versions exist), so
        // no album without versioning pays an extra query.
        // Versioning switched on in the database: photos still without a version row need a read.
        sql`exists (select 1 from ${schema.photos} vp join ${schema.galleries} vg on vg.id = vp.gallery_id where vg.versioning = 1 and vg.status != 'archived' and vg.folder_missing_since is null and coalesce(vg.sync_issues_json, '') not like '%"highres_empty"%' and not exists (select 1 from ${schema.photoVersions} pv where pv.photo_id = vp.id))`,
        sql`exists (select 1 from ${schema.photoVersions} pv join ${schema.galleries} vg on vg.id = pv.gallery_id where vg.versioning = 1 and vg.status != 'archived' and vg.folder_missing_since is null and pv.drive_versions like '%"missingSince"%')`,
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
  op();
  const allRows = await db.select().from(schema.galleries);
  const existing = allRows.filter((g) => !ignored.has(g.driveFolderId));
  // Only albums with galleries.versioning = 1 parse versions (T6.53b).
  const versioned = new Set(
    existing.filter((g) => g.versioning).map((g) => g.driveFolderId),
  );
  const albums = (await scan(rootId, drive, guard, versioned)).filter(
    (a) => !ignored.has(a.folder.id),
  );
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
  const { op } = run;
  const pass: AlbumPass = {
    result,
    syncedAt,
    // Client slugs share the namespace (T6.40a): a new album must not take one.
    takenSlugs: new Set([
      ...allRows.map((g) => g.slug.toLowerCase()),
      ...(await (op(), clientSlugs(run.env as Env))),
    ]),
    pendingIds: pending,
    versions: new Map(),
  };
  const rowsByGallery = await loadPhotoRows(run, albums, byFolder);
  pass.versions = await loadVersionState(
    run,
    albums.flatMap((a) => {
      const g = byFolder.get(a.folder.id);
      return g?.versioning ? [g.id] : [];
    }),
  );
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

/** The run context: Drive guard (external budget) and the Cloudflare-service op counter. */
function newRun(env: SyncEnv, opts: SyncOptions, now: Date): SyncRun {
  const { drive, budget = 45 } = opts;
  let cfOps = 0;
  const op: Op = (n = 1) => {
    cfOps += n;
    if (cfOps > CF_SUBREQUEST_CAP) throw new SyncBudgetError();
  };
  return {
    env,
    db: getDb(env as Env),
    drive,
    guard: makeGuard(drive, budget),
    op,
    now,
  };
}

export async function runSync(
  env: SyncEnv,
  opts: SyncOptions,
): Promise<SyncResult> {
  const { drive, force = false } = opts;
  const now = opts.now ?? new Date();
  const result = emptyResult();
  const startSubs = drive.subrequests();
  const run = newRun(env, opts, now);
  const { op } = run;
  const skippedAfterScan = (
    skipped: "unchanged" | "empty_root",
  ): SyncResult => ({
    ...result,
    skipped,
    subrequests: drive.subrequests() - startSubs,
  });

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
    if (detected.unchanged) return skippedAfterScan("unchanged");
    const nextToken = detected.nextToken;

    // 3-4. Scan (no writes yet) and read the current galleries.
    const { albums, allRows, existing } = await loadLibrary(run, rootId);
    if (albums.length === 0 && existing.length > 0) {
      // A transient empty listing must never archive the library.
      console.error("sync: root listing is empty but galleries exist; aborted");
      return skippedAfterScan("empty_root");
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
