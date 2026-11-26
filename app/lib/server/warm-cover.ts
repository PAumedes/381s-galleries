import { and, eq } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import type { DriveClient } from "./drive-types";
import { latestOf } from "./photo-versions";
import { fillCacheShared } from "./image-cache";
import type { Variant } from "./images";

const P = schema.photos;
const G = schema.galleries;

/**
 * Variants the editor shows right after a save. `view-lg` stays lazy: in
 * Prueba it is the very same preview-wm file as `view-sm` (one more Drive
 * fetch for the same bytes) and in Entrega it is the full original.
 */
export const COVER_WARM_VARIANTS: readonly Variant[] = ["thumb", "view-sm"];
/** External subrequests one cover save may spend (Workers Free allows 50). */
export const COVER_WARM_BUDGET = 8;
/**
 * Worst case of ONE Drive call: the file plus MAX_RETRIES (3) retries of 429/5xx,
 * plus one OAuth refresh. Reserved before every call so the budget really holds.
 */
const COVER_CALL_RESERVE = 3 + 2;

/**
 * After a successful cover save: puts that ONE photo's cover variants in R2
 * (same resolution, validation and metadata as /img, so Prueba stores only
 * watermarked files and a photo without preview-wm stores nothing). Stops
 * before the Drive subrequest budget would be exceeded; a failing variant
 * does not stop the others. Called from `ctx.waitUntil`.
 */
export async function warmCoverPhoto(
  env: Env,
  drive: DriveClient,
  galleryId: string,
  photoId: string,
): Promise<void> {
  const [row] = await getDb(env)
    .select({
      photo: {
        id: P.id,
        driveHighresId: P.driveHighresId,
        driveWebId: P.driveWebId,
        driveIgId: P.driveIgId,
        driveThumbId: P.driveThumbId,
        driveWmId: P.driveWmId,
        driveThumbWmId: P.driveThumbWmId,
        variantVersions: P.variantVersions,
      },
      mode: G.mode,
      versioning: G.versioning,
    })
    .from(P)
    .innerJoin(G, eq(G.id, P.galleryId))
    .where(and(eq(P.id, photoId), eq(P.galleryId, galleryId), photoVisible));
  if (!row) return;
  const [latest] = await latestOf(env, row, [row.photo]);
  const photo = { ...latest, proofing: row.mode === "proofing" };
  const start = drive.subrequests();
  for (const variant of COVER_WARM_VARIANTS) {
    if (drive.subrequests() - start + COVER_CALL_RESERVE > COVER_WARM_BUDGET)
      break;
    try {
      await fillCacheShared(env, photo, variant, drive);
    } catch {
      // Next variant; the first real view retries this one.
    }
  }
}
