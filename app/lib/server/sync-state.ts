import { nowIso } from "../../db";
import { IMAGE_VARIANTS } from "../constants";
import { chunk } from "./sync-helpers";
import * as settings from "./settings";
import { SETTINGS_KEYS } from "./settings";
import type { BatchItem, Op, SyncEnv, SyncRun } from "./sync-types";
import { D1_BATCH_MAX } from "./d1-limits";

/** Sync bookkeeping: counted settings access, the run lock, R2 deletes and D1 batches. */
export const LOCK_KEY = SETTINGS_KEYS.syncLock;
export const TOKEN_KEY = SETTINGS_KEYS.driveChangesToken;
export const LOCK_MS = 5 * 60_000;
export const PENDING_DELETES_KEY = SETTINGS_KEYS.r2PendingDeletes;
export const LAST_ERROR_KEY = SETTINGS_KEYS.syncLastError;
// ids are 36 chars; keep the JSON value well under D1's 100 KB statement limit.
export const PENDING_DELETES_CAP = 2000;

export const R2_DELETE_MAX = 1000;

// Op-counting wrappers: every settings read/write is one D1 subrequest.
export async function getSetting(env: SyncEnv, key: string, op: Op) {
  op();
  return settings.getSetting(env, key);
}

export async function putSetting(
  env: SyncEnv,
  key: string,
  value: string,
  op: Op,
) {
  op();
  await settings.putSetting(env, key, value);
}

export async function dropSetting(env: SyncEnv, key: string, op: Op) {
  op();
  await settings.deleteSetting(env, key);
}

/**
 * Deletes the known R2 keys of removed photos: ONE `delete(keys[])` call per
 * <=1000 keys (no list calls; each R2 call is a subrequest). The ids were
 * persisted in `r2_pending_deletes` in the same D1 batch that deleted their
 * rows, so a crash anywhere cannot orphan keys; ids that were cleaned are
 * removed from the list. Returns the ids still pending.
 */
export async function flushR2(
  env: SyncEnv,
  op: Op,
  pending: string[],
): Promise<string[]> {
  const ids = [...new Set(pending)];
  if (ids.length === 0) return [];
  const perCall = Math.floor(R2_DELETE_MAX / IMAGE_VARIANTS.length);
  let done = 0;
  try {
    for (; done < ids.length; done += perCall) {
      op();
      await env.CACHE.delete(
        ids
          .slice(done, done + perCall)
          .flatMap((id) => IMAGE_VARIANTS.map((k) => `${id}/${k}`)),
      );
    }
  } catch {
    console.error("sync: cache cleanup failed");
    const rest = ids.slice(done);
    await putSetting(env, PENDING_DELETES_KEY, JSON.stringify(rest), op);
    return rest;
  }
  await dropSetting(env, PENDING_DELETES_KEY, op);
  return [];
}

/**
 * Lock (expiry-based; only an expired lock can be taken over).
 * The one timestamp that is not a bare ISO value: `<iso>|<uuid>` (expiry + owner token).
 */
export const newLockValue = (now: Date) =>
  `${nowIso(new Date(now.getTime() + LOCK_MS))}|${crypto.randomUUID()}`;

export async function acquireLock(
  env: SyncEnv,
  lockValue: string,
  now: Date,
): Promise<boolean> {
  const got = await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value < ?3",
  )
    .bind(LOCK_KEY, lockValue, nowIso(now))
    .run();
  return Boolean(got.meta.changes);
}

/** Releases only our own lock (the value carries the owner token). */
export async function releaseLock(
  env: SyncEnv,
  lockValue: string,
): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE key = ?1 AND value = ?2")
    .bind(LOCK_KEY, lockValue)
    .run();
}

export async function flushBatches(
  { db, op }: SyncRun,
  stmts: BatchItem[],
): Promise<void> {
  if (stmts.length === 0) return;
  for (const part of chunk(stmts, D1_BATCH_MAX)) {
    op();
    await db.batch(part as [BatchItem, ...BatchItem[]]);
  }
}
