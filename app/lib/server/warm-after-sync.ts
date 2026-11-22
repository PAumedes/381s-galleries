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
import { meterD1 } from "./d1-meter";
import {
  AFTER_SYNC_WARM_D1_BUDGET,
  D1_FREE_QUERIES_PER_INVOCATION,
  FREE_SUBREQUESTS_PER_INVOCATION,
  INVOCATION_SAFETY,
} from "./d1-limits";
import {
  OPEN_WARM_BUDGET,
  d1Exhausted,
  warmGalleryPending,
} from "./gallery-warm";
import type { Allowance, OpenWarmResult } from "./gallery-warm";
import { SETTINGS_KEYS } from "./settings";
import type { SyncResult } from "./sync-types";
import { runScheduledWarm } from "./warm";

/** Drive subrequests the after-sync warm may spend (also bounds its D1 queries). */
export const AFTER_SYNC_WARM_BUDGET = 16;
/** Below this the after-sync warm is not worth starting (one photo's worst case is 5). */
const MIN_USEFUL_BUDGET = 10;
/** Below this many D1 queries the after-sync warm is not worth starting (one gallery's fixed cost + one photo). */
const MIN_USEFUL_D1_BUDGET = 16;
/** Marked galleries looked at per run. */
const PENDING_PER_RUN = 3;
/**
 * D1 queries a gallery costs before its walk: marker clear (1), gallery select
 * (1), sync-lock read, rate-limit hit (about 2), stamp and cursor reads, cursor save.
 */
const GALLERY_D1_RESERVE = 10;

const S = schema.settings;

/** Deletes a marker only if it was not renewed (by a later sync) meanwhile. */
async function clearMarker(env: Env, key: string, value: string) {
  await getDb(env)
    .delete(S)
    .where(and(eq(S.key, key), eq(S.value, value)));
}

/**
 * Moves a marker that got its turn but is not done to the back of the queue
 * (value = last attempt time), unless a later sync renewed it meanwhile. A
 * gallery whose file keeps failing therefore cannot starve newer marks.
 */
async function rotateMarker(env: Env, key: string, value: string) {
  await getDb(env)
    .update(S)
    .set({ value: new Date().toISOString() })
    .where(and(eq(S.key, key), eq(S.value, value)));
}

/**
 * Continues the warm of galleries a sync marked, least recently attempted
 * first (a mark's value is the sync time, then the last attempt), within
 * `budget` Drive subrequests and `d1Budget` D1 queries (every query of the run
 * is counted, including settings and rate-limit reads) in total. A spent D1
 * budget stops the run cleanly: cursors are saved and markers kept. Never
 * throws on Drive/R2 errors.
 */
export async function warmPendingGalleries(
  baseEnv: Env,
  drive: DriveClient,
  opts: { budget?: number; d1Budget?: number } = {},
): Promise<OpenWarmResult> {
  const total: OpenWarmResult = { warmed: 0, failed: 0 };
  if (baseEnv.DRIVE_MODE === "mock") return { ...total, skipped: "mock" };
  const meter = meterD1(baseEnv);
  const env = meter.env;
  const span: Allowance = {
    start: drive.subrequests(),
    budget: opts.budget ?? OPEN_WARM_BUDGET,
    d1: {
      used: meter.used,
      budget: opts.d1Budget ?? AFTER_SYNC_WARM_D1_BUDGET,
    },
  };
  const db = getDb(env);
  const marks = await db
    .select()
    .from(S)
    .where(like(S.key, SETTINGS_KEYS.warmPendingPrefix + "%"))
    .orderBy(asc(S.value), asc(S.key))
    .limit(PENDING_PER_RUN);
  for (const m of marks) {
    if (d1Exhausted(span, GALLERY_D1_RESERVE))
      return { ...total, stopped: "budget" };
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
    if (r.skipped === "sync_running")
      return { ...total, skipped: "sync_running" };
    if (r.finished) await clearMarker(env, m.key, m.value);
    else await rotateMarker(env, m.key, m.value);
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
  /** D1 queries the invocation already made (the sync's own, the admin check). */
  d1Used = 0,
): void {
  if (!deps?.ctx || !deps.drive || env.DRIVE_MODE === "mock") return;
  if (result.skipped || result.photos.added + result.photos.updated === 0)
    return;
  const budget = Math.min(
    AFTER_SYNC_WARM_BUDGET,
    FREE_SUBREQUESTS_PER_INVOCATION - INVOCATION_SAFETY - result.subrequests,
  );
  const d1Budget = Math.min(
    AFTER_SYNC_WARM_D1_BUDGET,
    D1_FREE_QUERIES_PER_INVOCATION - INVOCATION_SAFETY - d1Used,
  );
  if (budget < MIN_USEFUL_BUDGET || d1Budget < MIN_USEFUL_D1_BUDGET) return;
  const drive = deps.drive;
  deps.ctx.waitUntil(
    warmPendingGalleries(env, drive, { budget, d1Budget }).catch((err) => {
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
export async function runWarmCron(
  baseEnv: Env,
  drive: DriveClient,
): Promise<void> {
  const meter = meterD1(baseEnv);
  const cronD1Budget = D1_FREE_QUERIES_PER_INVOCATION - INVOCATION_SAFETY;
  const r = await runScheduledWarm(meter.env, drive, {
    d1: { used: meter.used, budget: cronD1Budget },
  });
  const free = r.skipped === "idle" || (!r.skipped && r.stale === 0);
  if (free)
    await warmPendingGalleries(meter.env, drive, {
      d1Budget: cronD1Budget - meter.used(),
    });
}
