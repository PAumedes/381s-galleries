/**
 * Orphan cache sweep (T6.59): a manual admin tool for R2 cache objects whose
 * photo is gone (`<photoId>/<variant>` and, from v2, `<photoId>/v<N>/<variant>`),
 * left behind before T6.55 or by a race the cleanup could not see. Their rows
 * are gone, so nothing else knows the keys: the bucket is LISTED, one bounded
 * page per request, and the owner runs a dry run first.
 *
 * Safety rules, each pinned by a test:
 *  - ALLOW-LIST: only keys that match `classifyCacheKey` (lowercase uuid, a
 *    known variant, optional `v2`..`v999`) are ever looked at; every other key
 *    (the studio logo, anything unknown or oddly shaped) is only counted as
 *    ignored and never touched.
 *  - A key is an orphan only when its photo has no `photos` row, or it is a
 *    v>=2 key and the photo has no `photo_versions` row for that version.
 *    Rows in grace (`missing_since`) still exist, so they protect their keys.
 *  - Entries still in `r2_pending_deletes` belong to the sync that queued them,
 *    and objects younger than SWEEP_MIN_AGE_MS may belong to a photo being
 *    added (a `/img` fill): both are "held", never deleted.
 *  - The delete pass trusts nothing from the scan: it lists again and, in the
 *    SAME request, re-reads D1 right before deleting (a photo created after the
 *    scan survives).
 *  - Only R2 cache keys are deleted (exact keys, in calls of <= 1000). Drive is
 *    never touched and no D1 row is written here.
 * Budget per request: one R2 list call (<= 1000 keys) + at most
 * SWEEP_WORST_CASE_D1_QUERIES D1 queries + one R2 delete call per 1000 orphans,
 * all inside the Workers Free limits; the caller continues with the cursor.
 */
import { IMAGE_VARIANTS } from "../constants";
import type { ImageVariant } from "../constants";
import {
  D1_FREE_QUERIES_PER_INVOCATION,
  D1_IN_CHUNK,
  INVOCATION_SAFETY,
} from "./d1-limits";
import { readPending } from "./gallery-delete";
import { cacheEntry } from "./image-source";
import { R2_DELETE_MAX } from "./sync-state";
import { chunk } from "./sync-helpers";

/** Keys per R2 list call (the R2 maximum). */
export const SWEEP_LIST_LIMIT = 1000;
/** Objects younger than this are never orphans (a `/img` fill or warm of a photo being added). */
export const SWEEP_MIN_AGE_MS = 60 * 60_000;
/** A delete pass needs a scan that finished within this long (the owner saw its totals). */
export const SWEEP_SCAN_VALID_MS = 24 * 60 * 60_000;
/** Longest cursor accepted from a form (R2 cursors are short opaque strings). */
export const SWEEP_CURSOR_MAX = 1024;
/** pending-deletes read + (photo lookups + version lookups) for the largest page, one id per key. */
export const SWEEP_WORST_CASE_D1_QUERIES =
  1 + 2 * Math.ceil(SWEEP_LIST_LIMIT / D1_IN_CHUNK);
if (
  SWEEP_WORST_CASE_D1_QUERIES >
  D1_FREE_QUERIES_PER_INVOCATION - INVOCATION_SAFETY
)
  throw new Error("orphan sweep page exceeds the D1 query budget");

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const VERSION = "v([2-9]|[1-9][0-9]{1,2})"; // 2..999, canonical digits
const KEY_RE = new RegExp(
  `^(${UUID})(?:/${VERSION})?/(${IMAGE_VARIANTS.join("|")})$`,
);

export interface CacheKeyParts {
  photoId: string;
  version: number;
  variant: ImageVariant;
}

/** The strict allow-list: what `cacheKey()` writes, nothing else (null = not ours, never touch). */
export function classifyCacheKey(key: string): CacheKeyParts | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  return {
    photoId: m[1],
    version: m[2] ? Number(m[2]) : 1,
    variant: m[3] as ImageVariant,
  };
}

export interface SweepTotals {
  /** Keys listed so far. */
  scanned: number;
  orphans: number;
  /** Bytes of the orphans (R2 reports every object's size). */
  bytes: number;
  /** Keys outside the allow-list: counted, never touched. */
  ignored: number;
  /** Keys of live photos' neighbours kept for now: too young or still pending. */
  held: number;
  deleted: number;
}

export const emptySweepTotals = (): SweepTotals => ({
  scanned: 0,
  orphans: 0,
  bytes: 0,
  ignored: 0,
  held: 0,
  deleted: 0,
});

/** Totals posted back by a form: never trusted, each field a safe non-negative integer or 0. */
export function parseSweepTotals(raw: unknown): SweepTotals {
  let v: unknown = null;
  try {
    v = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    /* start from zero */
  }
  const out = emptySweepTotals();
  if (typeof v !== "object" || v === null) return out;
  for (const k of Object.keys(out) as (keyof SweepTotals)[]) {
    const n = (v as Record<string, unknown>)[k];
    if (typeof n === "number" && Number.isSafeInteger(n) && n >= 0) out[k] = n;
  }
  return out;
}

/** Cursor posted back by a form: null = start; undefined = not acceptable. */
export function parseSweepCursor(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || raw.length > SWEEP_CURSOR_MAX)
    return undefined;
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f]/.test(raw) ? undefined : raw;
}

export interface SweepRequest {
  mode: "scan" | "delete";
  cursor: string | null;
  totals: SweepTotals;
  now?: Date;
  /** Keys per list call (tests only; default SWEEP_LIST_LIMIT). */
  listLimit?: number;
}

export interface SweepPage {
  totals: SweepTotals;
  /** Where the next request continues; null = the whole bucket was walked. */
  cursor: string | null;
}

type SweepEnv = Pick<Env, "DB" | "CACHE">;
type Listed = Pick<R2Object, "key" | "size" | "uploaded">;

/** Photo ids that have a `photos` row, in chunks under the bound-parameter limit. */
async function livePhotoIds(
  env: SweepEnv,
  ids: string[],
): Promise<Set<string>> {
  const live = new Set<string>();
  for (const part of chunk(ids, D1_IN_CHUNK)) {
    const { results } = await env.DB.prepare(
      `SELECT id FROM photos WHERE id IN (${part.map((_, i) => `?${i + 1}`).join(",")})`,
    )
      .bind(...part)
      .all<{ id: string }>();
    for (const r of results) live.add(r.id);
  }
  return live;
}

/** `<photoId>/<version>` pairs that have a `photo_versions` row (missing_since rows count: they still exist). */
async function liveVersions(
  env: SweepEnv,
  ids: string[],
): Promise<Set<string>> {
  const live = new Set<string>();
  for (const part of chunk(ids, D1_IN_CHUNK)) {
    const { results } = await env.DB.prepare(
      `SELECT photo_id, version FROM photo_versions WHERE photo_id IN (${part.map((_, i) => `?${i + 1}`).join(",")})`,
    )
      .bind(...part)
      .all<{ photo_id: string; version: number }>();
    for (const r of results) live.add(`${r.photo_id}/${r.version}`);
  }
  return live;
}

interface Candidate extends CacheKeyParts {
  key: string;
  size: number;
}

/** Of the candidates (allow-listed, old enough, not pending) the ones with no row: the orphans. */
async function findOrphans(
  env: SweepEnv,
  candidates: Candidate[],
): Promise<Candidate[]> {
  if (candidates.length === 0) return [];
  const ids = [...new Set(candidates.map((c) => c.photoId))];
  const photos = await livePhotoIds(env, ids);
  const versionedIds = [
    ...new Set(
      candidates
        .filter((c) => c.version >= 2 && photos.has(c.photoId))
        .map((c) => c.photoId),
    ),
  ];
  const versions = versionedIds.length
    ? await liveVersions(env, versionedIds)
    : new Set<string>();
  return candidates.filter(
    (c) =>
      !photos.has(c.photoId) ||
      (c.version >= 2 && !versions.has(`${c.photoId}/${c.version}`)),
  );
}

/** Splits a listing into candidates, ignored keys and held ones (too young, or pending). */
function sort(objects: Listed[], pending: Set<string>, youngAfter: number) {
  const candidates: Candidate[] = [];
  let ignored = 0;
  let held = 0;
  for (const o of objects) {
    const parts = classifyCacheKey(o.key);
    if (!parts) {
      ignored++;
      continue;
    }
    // Missing, invalid or unparseable upload times count as young.
    const young =
      !(o.uploaded instanceof Date) || !(o.uploaded.getTime() <= youngAfter);
    if (young || pending.has(cacheEntry(parts.photoId, parts.version))) held++;
    else candidates.push({ ...parts, key: o.key, size: o.size });
  }
  return { candidates, ignored, held };
}

/**
 * One page of the sweep: list, classify, look the photos up in D1 and, in
 * delete mode, delete the orphans right after (same request). Idempotent: a
 * page can be repeated and nothing outside the allow-list is ever deleted.
 */
export async function sweepPage(
  env: SweepEnv,
  {
    mode,
    cursor,
    totals,
    now = new Date(),
    listLimit = SWEEP_LIST_LIMIT,
  }: SweepRequest,
): Promise<SweepPage> {
  const listed = await env.CACHE.list({
    limit: Math.min(listLimit, SWEEP_LIST_LIMIT),
    ...(cursor ? { cursor } : {}),
  });
  const pending = new Set(listed.objects.length ? await readPending(env) : []);
  const { candidates, ignored, held } = sort(
    listed.objects,
    pending,
    now.getTime() - SWEEP_MIN_AGE_MS,
  );
  const orphans = await findOrphans(env, candidates);
  let deleted = 0;
  if (mode === "delete")
    for (const part of chunk(
      orphans.map((o) => o.key),
      R2_DELETE_MAX,
    )) {
      await env.CACHE.delete(part);
      deleted += part.length;
    }
  const next = listed.truncated ? (listed.cursor ?? null) : null;
  // An incomplete listing must never read as "the whole bucket was walked",
  // and a cursor that does not advance would loop forever.
  if (listed.truncated && (!next || next === cursor))
    throw new Error("orphan sweep: listing did not advance");
  return {
    cursor: next,
    totals: {
      scanned: totals.scanned + listed.objects.length,
      orphans: totals.orphans + orphans.length,
      bytes: totals.bytes + orphans.reduce((n, o) => n + o.size, 0),
      ignored: totals.ignored + ignored,
      held: totals.held + held,
      deleted: totals.deleted + deleted,
    },
  };
}
