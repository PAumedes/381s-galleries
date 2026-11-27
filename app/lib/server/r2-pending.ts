import { and, eq, gte } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { cacheEntry } from "./image-source";
import { getSetting, putSetting } from "./settings";
import { PENDING_DELETES_CAP, PENDING_DELETES_KEY } from "./sync-state";
import { parsePending } from "./sync-helpers";

/**
 * Adds the R2 entries of every version >= 2 of the album to the pending-delete
 * list (flushed by the next sync or gallery delete, same keys and batching as
 * removed photos). Used when versioning is switched OFF: the version rows stay,
 * but nothing may read or refill those objects any more, and a later photo
 * removal in an unversioned album would not know about them.
 */
export async function queueVersionCaches(
  env: Env,
  galleryId: string,
): Promise<void> {
  const V = schema.photoVersions;
  const rows = await getDb(env)
    .select({ id: V.photoId, version: V.version })
    .from(V)
    .where(and(eq(V.galleryId, galleryId), gte(V.version, 2)));
  if (rows.length === 0) return;
  const pending = parsePending(await getSetting(env, PENDING_DELETES_KEY));
  const merged = [
    ...new Set([...pending, ...rows.map((r) => cacheEntry(r.id, r.version))]),
  ].slice(-PENDING_DELETES_CAP);
  await putSetting(env, PENDING_DELETES_KEY, JSON.stringify(merged));
}
