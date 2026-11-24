/**
 * R2 cache warming (PLAN 5.3). A cron every minute copies `thumb` and
 * `view-sm` of photos whose cache is missing or stale from Drive into R2, so
 * the first visitor does not pay for a Drive stream (0.5-2 s, and many thumbs
 * at once hit Drive rate limits). Heavier variants stay lazy.
 *
 * `photos.cache_warm_key` records which versions were warmed; a photo is stale
 * when its expected key (file ids + watermark flags + Drive modifiedTimes of
 * thumb and view-sm) differs. Failures never move the marker, so they are
 * retried on the next run.
 */
import { and, eq } from "drizzle-orm";
import { getDb, nowIso, schema } from "../../db";
import type { D1Allowance } from "./d1-meter";
import type { DriveClient } from "./drive-types";
import { fillCache } from "./images";
import type { SourcePhoto } from "./images";
import { GalleryGone, gated } from "./warm-gate";
import { WARM_VARIANTS } from "./warm-key";
import { eligible, staleRows } from "./warm-stale";
import {
  SETTINGS_KEYS,
  deleteSetting,
  getSetting,
  putSetting,
} from "./settings";

/** External (Drive + OAuth) subrequests per run; Workers Free allows 50. */
export const WARM_DRIVE_BUDGET = 40;
/** Cloudflare-service (D1/R2) operations per run; the limit is 1000. */
const CF_CAP = 900;
const LOCK_MS = 3 * 60_000;
/** After a run that found nothing stale, skip the full scan for this long. */
export const WARM_IDLE_MS = 5 * 60_000;

const P = schema.photos;
const G = schema.galleries;

/** Back-off after the n-th consecutive failure of a photo, indexed by min(n, 3). */
export const WARM_BACKOFF_MS = [60_000, 5 * 60_000, 3_600_000, 86_400_000];

export interface WarmResult {
  skipped?: "mock" | "sync_running" | "locked" | "idle";
  /** Stale, retry-eligible photos selected at the start of the run (<= 200). */
  stale: number;
  warmed: number;
  failed: number;
  stopped?: "budget" | "cf";
}

export {
  COVER_WARM_BUDGET,
  COVER_WARM_VARIANTS,
  warmCoverPhoto,
} from "./warm-cover";

export { WARM_VARIANTS, expectedWarmKey, markWarmed } from "./warm-key";
export { WARM_SELECT_LIMIT, warmProgress } from "./warm-stale";

const empty = (): WarmResult => ({ stale: 0, warmed: 0, failed: 0 });

type Db = ReturnType<typeof getDb>;

/** Moves (success) or backs off (failure) the photo's warm marker; a D1 error counts as failed. */
async function recordOutcome(
  db: Db,
  photoId: string,
  ok: boolean,
  key: string,
  fails: number,
): Promise<"warmed" | "failed"> {
  try {
    if (ok) {
      await db
        .update(P)
        .set({
          cacheWarmKey: key,
          cacheWarmFailCount: 0,
          cacheWarmRetryAt: null,
        })
        .where(eq(P.id, photoId));
      return "warmed";
    }
    await db
      .update(P)
      .set({
        cacheWarmFailCount: fails + 1,
        cacheWarmRetryAt: nowIso(
          new Date(Date.now() + WARM_BACKOFF_MS[Math.min(fails, 3)]),
        ),
      })
      .where(eq(P.id, photoId));
    return "failed";
  } catch {
    return "failed";
  }
}

/**
 * Fetches thumb and view-sm of one photo into R2. "ok": both cached;
 * "failed": Drive/R2 refused or nothing cacheable (the marker must not move);
 * "budget": the Drive allowance cannot cover the next call; "gone": the gallery
 * was unpublished meanwhile. `left` is the remaining Drive budget, `spent`
 * records one Cloudflare-service fill.
 */
async function fillVariants(
  env: Env,
  drive: DriveClient,
  photo: SourcePhoto & { proofing: boolean },
  galleryId: string,
  left: () => number,
  spent: () => void,
): Promise<"ok" | "failed" | "budget" | "gone"> {
  // Every Drive fetch re-checks gallery status and mode (Entrega -> Prueba mid-photo).
  const gate = gated(env, drive, galleryId, photo.proofing);
  for (const variant of WARM_VARIANTS) {
    if (left() < 1) return "budget";
    try {
      spent();
      // "skipped" (nothing cacheable) is a failure: the marker must not move.
      if ((await fillCache(env, photo, variant, gate)) === "skipped")
        return "failed";
    } catch (err) {
      if (err instanceof GalleryGone) return "gone";
      // Name only: messages may hold Drive ids.
      console.error(
        "warm: fill failed",
        err instanceof Error ? err.name : "error",
      );
      return "failed";
    }
  }
  return "ok";
}

/** D1 queries per stale photo: expected-key write, visibility re-check, one gate select per variant fetch (2), outcome write. */
const PHOTO_D1_COST = 5;
/** D1 queries kept for what follows the batch (idle marker, lock release). */
const BATCH_D1_RESERVE = 4;

export async function warmBatch(
  env: Env,
  opts: { drive: DriveClient; budget?: number; d1?: D1Allowance },
): Promise<WarmResult> {
  const { drive, budget = WARM_DRIVE_BUDGET, d1 } = opts;
  const start = drive.subrequests();
  const used = () => drive.subrequests() - start;
  let cf = 0;

  // The select itself is one query; the rest of the allowance buys photos.
  const maxRows = d1
    ? Math.max(
        0,
        Math.floor(
          (d1.budget - d1.used() - 1 - BATCH_D1_RESERVE) / PHOTO_D1_COST,
        ),
      )
    : Infinity;
  const { rows: stale, writes, more } = await staleRows(env, maxRows);
  cf += 1 + writes;
  // `more`: photos were left unexamined, so the library is not idle yet.
  const result: WarmResult = {
    ...empty(),
    stale: stale.length || (more ? 1 : 0),
  };
  const db = getDb(env);

  for (const { photo, wm, key, fails } of stale) {
    if (cf + 8 > CF_CAP) {
      result.stopped = "cf";
      break;
    }
    // Visibility / watermark flag may have changed since the selection.
    cf += 1;
    const [now] = await db
      .select({ mode: G.mode, galleryId: G.id })
      .from(P)
      .innerJoin(G, eq(G.id, P.galleryId))
      .where(and(eq(P.id, photo.id), eligible))
      .limit(1);
    if (!now || (now.mode === "proofing") !== wm) continue;

    const filled = await fillVariants(
      env,
      drive,
      { ...photo, proofing: wm },
      now.galleryId,
      () => budget - used(),
      () => (cf += 3),
    );
    if (filled === "budget") {
      result.stopped = "budget";
      break;
    }
    if (filled === "gone") continue;
    const ok = filled === "ok";
    cf += 1;
    result[await recordOutcome(db, photo.id, ok, key, fails)]++;
    if (used() > budget) {
      result.stopped = "budget";
      break;
    }
  }
  return result;
}

const lockHeld = (value: string | undefined) =>
  !!value && value.split("|")[0] > nowIso();

/**
 * Cron entry (every minute). Never overlaps itself (`warm_lock`, expiry
 * based) and never runs while a sync holds `sync_lock`. When a full scan finds
 * nothing to warm it backs off for a few minutes (`warm_idle`), so idle
 * minutes cost one tiny settings read and no subrequests; a sync that changed
 * anything clears the back-off.
 */
export async function runScheduledWarm(
  env: Env,
  drive: DriveClient,
  opts: { d1?: D1Allowance } = {},
): Promise<WarmResult> {
  if (env.DRIVE_MODE === "mock") return { ...empty(), skipped: "mock" };
  if (lockHeld(await getSetting(env, SETTINGS_KEYS.syncLock)))
    return { ...empty(), skipped: "sync_running" };
  const idle = await getSetting(env, SETTINGS_KEYS.warmIdle);
  if (idle && idle > nowIso()) return { ...empty(), skipped: "idle" };

  const lockValue = `${nowIso(new Date(Date.now() + LOCK_MS))}|${crypto.randomUUID()}`;
  const got = await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value < ?3",
  )
    .bind(SETTINGS_KEYS.warmLock, lockValue, nowIso())
    .run();
  if (!got.meta.changes) return { ...empty(), skipped: "locked" };
  try {
    // A sync may have started between the check and taking our lock.
    if (lockHeld(await getSetting(env, SETTINGS_KEYS.syncLock)))
      return { ...empty(), skipped: "sync_running" };
    const stamp = await getSetting(env, SETTINGS_KEYS.warmStamp);
    const r = await warmBatch(env, { drive, d1: opts.d1 });
    // Idle only if nothing (sync, watermark toggle) touched photos meanwhile.
    if (r.stale === 0) {
      if ((await getSetting(env, SETTINGS_KEYS.warmStamp)) === stamp)
        await putSetting(
          env,
          SETTINGS_KEYS.warmIdle,
          nowIso(new Date(Date.now() + WARM_IDLE_MS)),
        );
    } else await deleteSetting(env, SETTINGS_KEYS.warmIdle);
    return r;
  } finally {
    await env.DB.prepare("DELETE FROM settings WHERE key = ?1 AND value = ?2")
      .bind(SETTINGS_KEYS.warmLock, lockValue)
      .run();
  }
}
