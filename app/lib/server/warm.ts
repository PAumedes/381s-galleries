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
import { and, asc, desc, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getDb, nowIso, photoVisible, schema } from "../../db";
import type { DriveClient } from "./drive-types";
import { fillCache, fillCacheShared, resolveSource } from "./images";
import type { SourcePhoto, Variant } from "./images";
import {
  SETTINGS_KEYS,
  deleteSetting,
  getSetting,
  putSetting,
} from "./settings";

export const WARM_VARIANTS: readonly Variant[] = ["thumb", "view-sm"];
/** External (Drive + OAuth) subrequests per run; Workers Free allows 50. */
export const WARM_DRIVE_BUDGET = 40;
/** Cloudflare-service (D1/R2) operations per run; the limit is 1000. */
const CF_CAP = 900;
const LOCK_MS = 3 * 60_000;
/** After a run that found nothing stale, skip the full scan for this long. */
export const WARM_IDLE_MS = 5 * 60_000;

type Photo = SourcePhoto;

/** Stale photos looked at per run (bounds D1 rows read). */
export const WARM_SELECT_LIMIT = 200;
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
    })
    .from(P)
    .innerJoin(G, eq(G.id, P.galleryId))
    .where(and(eq(P.id, photoId), eq(P.galleryId, galleryId), photoVisible));
  if (!row) return;
  const photo = { ...row.photo, proofing: row.mode === "proofing" };
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

const empty = (): WarmResult => ({ stale: 0, warmed: 0, failed: 0 });

/** Hash of what a fully warmed `photo` looks like (16 hex chars). */
export async function expectedWarmKey(
  photo: Photo,
  proofing: boolean,
): Promise<string> {
  const parts = WARM_VARIANTS.map((v) => {
    const s = resolveSource(photo, proofing, v);
    return s
      ? `${v}|${s.fileId}|${s.watermark ? 1 : 0}|${s.version}`
      : v + "|-";
  });
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(parts.join("\n")),
  );
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

const P = schema.photos;
const G = schema.galleries;
const eligible = and(ne(G.status, "archived"), photoVisible);

/**
 * Stale, retry-eligible photos (newest gallery first, never-failed first),
 * at most WARM_SELECT_LIMIT, with only the columns warming needs. Rows whose
 * expected key is unknown (NULL) get it computed here and written back; those
 * that turn out current are dropped.
 */
async function staleRows(env: Env): Promise<{
  rows: { photo: Photo; wm: boolean; key: string; fails: number }[];
  writes: number;
}> {
  const db = getDb(env);
  const found = await db
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
      warmKey: P.cacheWarmKey,
      expected: P.cacheExpectedKey,
      fails: P.cacheWarmFailCount,
      mode: G.mode,
    })
    .from(P)
    .innerJoin(G, eq(G.id, P.galleryId))
    .where(
      and(
        eligible,
        or(
          isNull(P.cacheExpectedKey),
          sql`${P.cacheWarmKey} IS NOT ${P.cacheExpectedKey}`,
        ),
        or(isNull(P.cacheWarmRetryAt), lte(P.cacheWarmRetryAt, nowIso())),
      ),
    )
    .orderBy(
      sql`${P.cacheWarmFailCount} > 0`,
      desc(G.createdAt),
      asc(G.id),
      asc(P.setName),
      asc(P.sort),
      asc(P.baseName),
    )
    .limit(WARM_SELECT_LIMIT);
  const rows: { photo: Photo; wm: boolean; key: string; fails: number }[] = [];
  let writes = 0;
  for (const r of found) {
    let key = r.expected;
    if (key === null) {
      key = await expectedWarmKey(r.photo, r.mode === "proofing");
      writes++;
      await db
        .update(P)
        .set({ cacheExpectedKey: key })
        .where(and(eq(P.id, r.photo.id), isNull(P.cacheExpectedKey)));
      if (r.warmKey === key) continue;
    }
    rows.push({
      photo: r.photo,
      wm: r.mode === "proofing",
      key,
      fails: r.fails,
    });
  }
  return { rows, writes };
}

/** "Fotos en caché: N / M": photos whose marker is current vs visible photos. */
export async function warmProgress(
  env: Env,
): Promise<{ warmed: number; total: number }> {
  const db = getDb(env);
  const count = (extra?: SQL) =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(P)
      .innerJoin(G, eq(G.id, P.galleryId))
      .where(and(eligible, extra))
      .then((r) => r[0]?.n ?? 0);
  const [total, warmed] = await Promise.all([
    count(),
    count(sql`${P.cacheWarmKey} = ${P.cacheExpectedKey}`),
  ]);
  return { warmed, total };
}

export async function warmBatch(
  env: Env,
  opts: { drive: DriveClient; budget?: number },
): Promise<WarmResult> {
  const { drive, budget = WARM_DRIVE_BUDGET } = opts;
  const start = drive.subrequests();
  const used = () => drive.subrequests() - start;
  let cf = 0;

  const { rows: stale, writes } = await staleRows(env);
  cf += 1 + writes;
  const result: WarmResult = { ...empty(), stale: stale.length };
  const db = getDb(env);

  outer: for (const { photo, wm, key, fails } of stale) {
    if (cf + 8 > CF_CAP) {
      result.stopped = "cf";
      break;
    }
    // Visibility / watermark flag may have changed since the selection.
    cf += 1;
    const [now] = await db
      .select({ mode: G.mode })
      .from(P)
      .innerJoin(G, eq(G.id, P.galleryId))
      .where(and(eq(P.id, photo.id), eligible))
      .limit(1);
    if (!now || (now.mode === "proofing") !== wm) continue;

    let ok = true;
    for (const variant of WARM_VARIANTS) {
      if (used() + 1 > budget) {
        result.stopped = "budget";
        break outer;
      }
      try {
        cf += 2;
        // "skipped" (nothing cacheable) is a failure: the marker must not move.
        if (
          (await fillCache(env, { ...photo, proofing: wm }, variant, drive)) ===
          "skipped"
        ) {
          ok = false;
          break;
        }
      } catch (err) {
        // Name only: messages may hold Drive ids.
        console.error(
          "warm: fill failed",
          err instanceof Error ? err.name : "error",
        );
        ok = false;
        break;
      }
    }
    try {
      cf += 1;
      if (ok) {
        await db
          .update(P)
          .set({
            cacheWarmKey: key,
            cacheWarmFailCount: 0,
            cacheWarmRetryAt: null,
          })
          .where(eq(P.id, photo.id));
        result.warmed++;
      } else {
        await db
          .update(P)
          .set({
            cacheWarmFailCount: fails + 1,
            cacheWarmRetryAt: nowIso(
              new Date(Date.now() + WARM_BACKOFF_MS[Math.min(fails, 3)]),
            ),
          })
          .where(eq(P.id, photo.id));
        result.failed++;
      }
    } catch {
      result.failed++;
    }
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
    const r = await warmBatch(env, { drive });
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
