import { inArray } from "drizzle-orm";
import { schema } from "../../db";
import { D1_IN_CHUNK } from "./d1-limits";
import { chunk } from "./sync-helpers";
import type { AlbumDraft } from "./sync-helpers";
import { SYNC_DELETE_GRACE_MS } from "./sync-types";
import { flushBatches } from "./sync-state";
import type { BatchItem, GalleryRow, Row, SyncRun } from "./sync-types";

/** Reconciling photos and galleries that disappeared from Drive. */
/** One chunked IN query per <=90 galleries instead of one select each. */
export async function loadPhotoRows(
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

export const graceElapsed = (now: Date, since: string | null) =>
  since !== null && now.getTime() - Date.parse(since) > SYNC_DELETE_GRACE_MS;

/**
 * Albums whose folder is gone: mark first, archive only after the grace
 * period (remembering the previous status), rows are always kept.
 * Returns how many galleries were archived by this run.
 */
export async function archiveAbsent(
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
