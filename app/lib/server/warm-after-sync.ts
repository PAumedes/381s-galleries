/**
 * Warm the R2 cache after a sync (T6.39).
 *
 * Sync never warms inside its own invocation budget. Instead its batch marks
 * every gallery it added/changed photos in with a `warm_pending:<galleryId>`
 * row (sync-album.ts). The same photo writes bump `warm_stamp` (DB triggers),
 * which resets the gallery's warm cursor, so the walk of `gallery-warm.ts`
 * starts again and fetches only what R2 lacks or holds in an older version
 * (Prueba: watermarked files only, that is `fillCache`'s rule).
 *
 * Who continues a marked gallery, each within the Free limits (50
 * subrequests per invocation):
 *  - `scheduleWarmAfterSync`: `ctx.waitUntil` of the admin sync request, only
 *    when the sync left budget;
 *  - `runWarmCron`: the minute cron, after its own thumb/view-sm scan, only
 *    when that scan had nothing stale (its budget is not shared).
 * A marker clears when the gallery's cursor is `done`; a gallery larger than
 * one run simply stays marked and continues on the next run. Draft, archived,
 * expired and deleted galleries drop their marker (publishing warms them).
 */
import { and, asc, eq, like } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { isAvailable } from "./access";
import type { DriveClient } from "./drive-types";
import { OPEN_WARM_BUDGET, warmGalleryPending } from "./gallery-warm";
import type { OpenWarmResult } from "./gallery-warm";
import { SETTINGS_KEYS } from "./settings";
import type { SyncResult } from "./sync-types";
import { runScheduledWarm } from "./warm";

/** Workers Free: subrequests per invocation. */
const SUBREQUESTS_PER_INVOCATION = 50;
/** Left unspent in the invocation that ran the sync (OAuth refresh, D1/R2 calls). */
const AFTER_SYNC_SAFETY = 5;
/** Drive subrequests the after-sync warm may spend (also bounds its D1 queries). */
export const AFTER_SYNC_WARM_BUDGET = 16;
/** Below this the after-sync warm is not worth starting (one photo's worst case is 5). */
const MIN_USEFUL_BUDGET = 10;
/** Marked galleries looked at per run. */
const PENDING_PER_RUN = 3;

const S = schema.settings;

/** Deletes a marker only if it was not renewed (by a later sync) meanwhile. */
async function clearMarker(env: Env, key: string, value: string) {
  await getDb(env)
    .delete(S)
    .where(and(eq(S.key, key), eq(S.value, value)));
}

/**
 * Continues the warm of galleries a sync marked, oldest mark first, within
 * `budget` Drive subrequests in total. Never throws on Drive/R2 errors.
 */
export async function warmPendingGalleries(
  env: Env,
  drive: DriveClient,
  opts: { budget?: number } = {},
): Promise<OpenWarmResult> {
  const total: OpenWarmResult = { warmed: 0, failed: 0 };
  if (env.DRIVE_MODE === "mock") return { ...total, skipped: "mock" };
  const span = {
    start: drive.subrequests(),
    budget: opts.budget ?? OPEN_WARM_BUDGET,
  };
  const db = getDb(env);
  const marks = await db
    .select()
    .from(S)
    .where(like(S.key, SETTINGS_KEYS.warmPendingPrefix + "%"))
    .orderBy(asc(S.value))
    .limit(PENDING_PER_RUN);
  for (const m of marks) {
    const id = m.key.slice(SETTINGS_KEYS.warmPendingPrefix.length);
    const [g] = await db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.id, id));
    if (!isAvailable(g)) {
      await clearMarker(env, m.key, m.value);
      continue;
    }
    const r = await warmGalleryPending(env, drive, g, span);
    total.warmed += r.warmed;
    total.failed += r.failed;
    if (r.finished) await clearMarker(env, m.key, m.value);
    if (r.skipped === "sync_running")
      return { ...total, skipped: "sync_running" };
    if (r.stopped === "budget") return { ...total, stopped: "budget" };
  }
  return total;
}

/**
 * Right after a sync that added/changed photos: hands a bounded warm to
 * `waitUntil` if the sync left Drive budget in this invocation. Nothing
 * without ctx/drive (mock mode); the cron continues otherwise.
 */
export function scheduleWarmAfterSync(
  env: Env,
  deps:
    | { ctx?: Pick<ExecutionContext, "waitUntil">; drive?: DriveClient }
    | undefined,
  result: SyncResult,
): void {
  if (!deps?.ctx || !deps.drive || env.DRIVE_MODE === "mock") return;
  if (result.skipped || result.photos.added + result.photos.updated === 0)
    return;
  const left =
    SUBREQUESTS_PER_INVOCATION - AFTER_SYNC_SAFETY - result.subrequests;
  const budget = Math.min(AFTER_SYNC_WARM_BUDGET, left);
  if (budget < MIN_USEFUL_BUDGET) return;
  const drive = deps.drive;
  deps.ctx.waitUntil(
    warmPendingGalleries(env, drive, { budget }).catch((err) => {
      console.error(
        "warm-after-sync: failed",
        err instanceof Error ? err.name : "error",
      );
    }),
  );
}

/**
 * Minute cron: the thumb/view-sm scan first; when it had nothing to do (idle
 * or nothing stale) its Drive budget is free, so marked galleries continue
 * (view-lg and any rest of a big gallery).
 */
export async function runWarmCron(env: Env, drive: DriveClient): Promise<void> {
  const r = await runScheduledWarm(env, drive);
  const free = r.skipped === "idle" || (!r.skipped && r.stale === 0);
  if (free) await warmPendingGalleries(env, drive);
}
