import { eq, inArray } from "drizzle-orm";
import { schema } from "../../db";
import { D1_IN_CHUNK, PHOTO_INSERT_ROWS } from "./d1-limits";
import { uniqueSlug } from "./slug";
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
} from "./sync-helpers";
import type { AlbumDraft, PhotoDraft } from "./sync-helpers";
import type {
  BatchItem,
  Db,
  GalleryRow,
  Row,
  SyncResult,
  SyncRun,
} from "./sync-types";

/** Per-album reconcile: gallery row and photo statements from the scanned state. */
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

/** State shared by the per-album steps of one reconcile pass. */
export interface AlbumPass {
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
  if (fresh.length || changed) stmts.push(warmMarker(db, galleryId, syncedAt));
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
export async function syncAlbum(
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
