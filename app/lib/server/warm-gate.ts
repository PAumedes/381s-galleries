/**
 * Drive client gate shared by every warm path (open, publish, pending, cron).
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { isAvailable } from "./access";
import type { DriveClient } from "./drive-types";

const G = schema.galleries;

/** Thrown by the gated Drive client when the gallery stopped being warmable. */
export class GalleryGone extends Error {}

/**
 * One cheap select: is the gallery still published, unexpired and in the mode
 * the walk started in (it may have been unpublished or switched Entrega <->
 * Prueba mid-warm; a switched gallery must not get files of the old mode)?
 */
export async function stillAvailable(
  env: Env,
  galleryId: string,
  proofing: boolean,
): Promise<boolean> {
  const [g] = await getDb(env).select().from(G).where(eq(G.id, galleryId));
  return isAvailable(g) && (g.mode === "proofing") === proofing;
}

/**
 * The Drive client a warm fills with: every fetch re-checks the gallery first
 * (one D1 select per real Drive call, none for files R2 already holds), so no
 * file of a stale mode is ever fetched and the D1 cost is bounded by the
 * Drive budget.
 */
export function gated(
  env: Env,
  drive: DriveClient,
  galleryId: string,
  proofing: boolean,
): DriveClient {
  return {
    subrequests: () => drive.subrequests(),
    async streamFile(id, opts) {
      if (!(await stillAvailable(env, galleryId, proofing)))
        throw new GalleryGone();
      return drive.streamFile(id, opts);
    },
  } as DriveClient;
}
