import { eq, inArray } from "drizzle-orm";
import { schema } from "../../db";
import { D1_IN_CHUNK, PHOTO_INSERT_ROWS } from "./d1-limits";
import { uniqueSlug } from "./slug";
import { SLUG_TAKEN_TRIGGER_MESSAGE, allSlugs } from "./slug-namespace";
import { SETTINGS_KEYS } from "./settings";
import { graceElapsed } from "./sync-archive";
import {
  PENDING_DELETES_CAP,
  PENDING_DELETES_KEY,
  flushBatches,
} from "./sync-state";
import {
  capIssues,
  chunk,
  cmp,
  issueCmp,
  keyOf,
  nfc,
  parseFolderDate,
  photoFields,
} from "./sync-helpers";
import type { AlbumDraft, PhotoDraft } from "./sync-helpers";
import { cacheEntry } from "./image-source";
import { versionStatements } from "./sync-version-rows";
import type { VersionState, VersionTarget } from "./sync-version-rows";
import type {
  BatchItem,
  Db,
  GalleryRow,
  Row,
  SyncResult,
  SyncRun,
} from "./sync-types";

/** Per-album reconcile: gallery row and photo statements from the scanned state. */
/** Count of ops against the Cloudflare-services subrequest pool (D1/R2). */

/** State shared by the per-album steps of one reconcile pass. */
export interface AlbumPass {
  result: SyncResult;
  syncedAt: string;
  takenSlugs: Set<string>;
  /** Removed photo ids whose R2 keys still need deleting (persisted with the row deletes). */
  pendingIds: string[];
  /** Rounds and version rows of the versioned galleries of this run (T6.53b). */
  versions: Map<string, VersionState>;
}

/** The status an existing gallery returns to: only galleries sync itself archived come back; an admin-archived one stays archived. */
function restoreStatus(ex: GalleryRow) {
  return ex.archivedBySync && ex.status === "archived"
    ? (ex.archivedPrevStatus ?? "draft")
    : undefined;
}

/** The update of an existing gallery row after a sync (lastSyncedAt, issues, un-missing, un-archive). */
function updateGalleryStmt(
  { db }: SyncRun,
  syncedAt: string,
  a: AlbumDraft,
  ex: GalleryRow,
  issuesJson: string,
  restore: GalleryRow["status"] | undefined,
) {
  return db
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
    .where(eq(schema.galleries.id, ex.id));
}

function insertGalleryStmt(
  { env, db }: SyncRun,
  { syncedAt, takenSlugs }: AlbumPass,
  a: AlbumDraft,
  galleryId: string,
  issuesJson: string,
) {
  const full = nfc(a.folder.name);
  const { title, eventDate } = parseFolderDate(full);
  return db.insert(schema.galleries).values({
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
  });
}

/**
 * The gallery-row statement(s) for one album: an update of an existing
 * gallery (only when something changed, or it must come back from a missing /
 * sync-archived state) or the insert of a new one.
 */
function galleryStatements(
  run: SyncRun,
  pass: AlbumPass,
  a: AlbumDraft,
  ex: GalleryRow | undefined,
  galleryId: string,
  issuesJson: string,
): BatchItem[] {
  const { result, syncedAt } = pass;
  if (!ex) {
    result.galleries.created++;
    return [insertGalleryStmt(run, pass, a, galleryId, issuesJson)];
  }
  const restore = restoreStatus(ex);
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
  return changed || ex.folderMissingSince !== null || ex.archivedBySync
    ? [updateGalleryStmt(run, syncedAt, a, ex, issuesJson, restore)]
    : [];
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
  let changed = 0;
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
    if (differs) {
      result.photos.updated++;
      changed++;
    }
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
    changed,
    toDelete: gone.filter((r) => graceElapsed(now, r.missingSince)),
    toMark: gone.filter((r) => r.missingSince === null),
  };
}

/** Marks the gallery as needing a cache warm (warm-after-sync.ts); renewed by every sync that changes photos. */
const warmMarker = (db: Db, galleryId: string, syncedAt: string) => {
  const key = SETTINGS_KEYS.warmPendingPrefix + galleryId;
  return db
    .insert(schema.settings)
    .values({ key, value: syncedAt })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: syncedAt },
    });
};

/** Persists the removed photo ids in the same batch as the row deletes: they survive any later failure. */
function pendingDeletesStmt(db: Db, pass: AlbumPass, goneIds: string[]) {
  pass.pendingIds = [...new Set([...pass.pendingIds, ...goneIds])].slice(
    -PENDING_DELETES_CAP,
  );
  const value = JSON.stringify(pass.pendingIds);
  return db
    .insert(schema.settings)
    .values({ key: PENDING_DELETES_KEY, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

/** Inserts for the new photos, in capture order, appended after the existing sort values. */
function insertPhotoStmts(
  db: Db,
  galleryId: string,
  fresh: PhotoDraft[],
  rows: Row[],
  idOf: (p: PhotoDraft) => string,
): BatchItem[] {
  fresh.sort(freshOrder);
  let sort = rows.reduce((m, r) => Math.max(m, r.sort), -1) + 1;
  // D1 allows 100 bound parameters per statement (d1-limits.ts); a photo row binds ~18.
  return chunk(fresh, PHOTO_INSERT_ROWS).map((part) =>
    db.insert(schema.photos).values(
      part.map((p) => ({
        id: idOf(p),
        galleryId,
        ...photoFields(p),
        sort: sort++,
      })),
    ),
  );
}

/** The album's photos with their row ids (existing rows by name, new ones from `freshIds`). */
function versionTargets(
  a: AlbumDraft,
  rows: Row[],
  freshIds: Map<PhotoDraft, string>,
): VersionTarget[] {
  const idByKey = new Map(
    rows.map((r) => [keyOf(r.setName, r.baseName), r.id]),
  );
  return a.photos.map((draft) => ({
    draft,
    photoId:
      freshIds.get(draft) ?? idByKey.get(keyOf(draft.setName, draft.baseName))!,
  }));
}

/** R2 entries of the versions >= 2 of removed photos (read now: the rows cascade away with them). */
function goneVersionEntries(
  vstate: VersionState | undefined,
  goneIds: string[],
): string[] {
  if (!vstate || goneIds.length === 0) return [];
  const gone = new Set(goneIds);
  return vstate.versions
    .filter((v) => gone.has(v.photoId) && v.version >= 2)
    .map((v) => cacheEntry(v.photoId, v.version));
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
  vstate: VersionState | undefined,
): BatchItem[] {
  const { db } = run;
  const { result, syncedAt } = pass;
  const { fresh, updates, changed, toDelete, toMark } = diffPhotos(
    run,
    pass,
    a,
    rows,
  );
  const goneIds = toDelete.map((r) => r.id);
  result.photos.removed += goneIds.length;
  result.photos.added += fresh.length;
  const stmts: BatchItem[] = [];
  const freshIds = new Map(fresh.map((p) => [p, crypto.randomUUID()]));
  const versions = vstate
    ? versionStatements(
        run,
        galleryId,
        syncedAt,
        versionTargets(a, rows, freshIds),
        vstate,
      )
    : { before: [], after: [], goneEntries: [] };
  // R2 keys to delete: the removed photos' (and, in versioned albums, every
  // version's: `<id>/v<N>/...`) plus those of version rows deleted after their grace.
  const goneEntries = [
    ...goneIds,
    ...goneVersionEntries(vstate, goneIds),
    ...versions.goneEntries,
  ];

  if (goneEntries.length) stmts.push(pendingDeletesStmt(db, pass, goneEntries));
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
  stmts.push(...versions.before, ...updates);
  if (fresh.length || changed) stmts.push(warmMarker(db, galleryId, syncedAt));
  stmts.push(
    ...insertPhotoStmts(db, galleryId, fresh, rows, (p) => freshIds.get(p)!),
    ...versions.after,
  );
  return stmts;
}

/** True when D1 aborted with the namespace trigger (a client took the slug after our snapshot). */
export function isSlugTakenError(err: unknown): boolean {
  const msg = (e: unknown) => String(e instanceof Error ? e.message : e);
  return (
    msg(err).includes(SLUG_TAKEN_TRIGGER_MESSAGE) ||
    msg(err instanceof Error ? err.cause : "").includes(
      SLUG_TAKEN_TRIGGER_MESSAGE,
    )
  );
}

const EMPTY: VersionState = { rounds: [], versions: [] };

/** Writes one album: gallery row first, then (unless high-res is empty) its photo diff. */
export async function syncAlbum(
  run: SyncRun,
  pass: AlbumPass,
  a: AlbumDraft,
  ex: GalleryRow | undefined,
  rows: Row[],
): Promise<void> {
  const before = structuredClone(pass.result);
  const pendingBefore = pass.pendingIds;
  try {
    await writeAlbum(run, pass, a, ex, rows);
  } catch (err) {
    if (ex || !isSlugTakenError(err)) throw err;
    // The create batch is atomic, so nothing was written: re-read the slugs
    // (a client appeared after the snapshot), undo the counters, retry once.
    run.op(2);
    for (const s of await allSlugs(run.env as Env)) pass.takenSlugs.add(s);
    Object.assign(pass.result, before);
    pass.pendingIds = pendingBefore;
    await writeAlbum(run, pass, a, ex, rows);
  }
}

async function writeAlbum(
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
    stmts.push(
      ...photoStatements(
        run,
        pass,
        a,
        rows,
        galleryId,
        ex?.versioning ? (pass.versions.get(galleryId) ?? EMPTY) : undefined,
      ),
    );
  await flushBatches(run, stmts);
}
