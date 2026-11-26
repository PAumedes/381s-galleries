/** Which photos the cron still has to warm (stale marker, retry-eligible) and how many are done. */
import { and, asc, desc, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getDb, nowIso, photoVisible, schema } from "../../db";
import type { SourcePhoto } from "./images";
import { D1_IN_CHUNK } from "./d1-limits";
import { atLatestVersion, loadVersionsOf } from "./photo-versions";
import { expectedWarmKey } from "./warm-key";

type Photo = SourcePhoto;
const P = schema.photos;
const G = schema.galleries;

/** Stale photos looked at per run (bounds D1 rows read). */
export const WARM_SELECT_LIMIT = 200;
export const eligible = and(ne(G.status, "archived"), photoVisible);

type StaleRow = { photo: Photo; wm: boolean; key: string; fails: number };

/** The stale, retry-eligible photos (newest gallery first, never-failed first), with only the columns warming needs. */
function selectStale(db: ReturnType<typeof getDb>) {
  return db
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
      versioning: G.versioning,
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
}

/**
 * Stale, retry-eligible photos (newest gallery first, never-failed first),
 * at most WARM_SELECT_LIMIT, with only the columns warming needs. Rows whose
 * expected key is unknown (NULL) get it computed here and written back; those
 * that turn out current are dropped.
 */
export async function staleRows(
  env: Env,
  maxRows = Infinity,
): Promise<{
  rows: StaleRow[];
  /** D1 operations beyond the select: key writes and version lookups. */
  writes: number;
  /** Stopped at `maxRows` with rows left unexamined (the next run continues). */
  more: boolean;
}> {
  const db = getDb(env);
  const found = await selectStale(db);
  // Versioned albums: the photo is warmed at the version its gallery shows
  // (T6.53c). Their version rows cost D1 queries (one per D1_IN_CHUNK photos,
  // only for rows this run can reach), which come out of `maxRows`.
  const reachable = found.slice(0, Math.min(found.length, maxRows * 2));
  const versionedIds = reachable
    .filter((r) => r.versioning)
    .map((r) => r.photo.id);
  const lookups = Math.ceil(versionedIds.length / D1_IN_CHUNK);
  const live = await loadVersionsOf(env, versionedIds);
  const limit = Math.max(0, maxRows - lookups);
  const rows: StaleRow[] = [];
  let writes = lookups;
  let more = false;
  for (const r of found) {
    // Each row costs a key write and an outcome write: `limit` bounds D1.
    if (rows.length >= limit || writes - lookups >= limit) {
      more = true;
      break;
    }
    const wm = r.mode === "proofing";
    const photo = r.versioning
      ? atLatestVersion(r.photo, live.get(r.photo.id), wm)
      : r.photo;
    let key = r.expected;
    if (key === null) {
      key = await expectedWarmKey(photo, wm);
      writes++;
      await db
        .update(P)
        .set({ cacheExpectedKey: key })
        .where(and(eq(P.id, r.photo.id), isNull(P.cacheExpectedKey)));
      if (r.warmKey === key) continue;
    }
    rows.push({ photo, wm, key, fails: r.fails });
  }
  return { rows, writes, more };
}

/**
 * "Fotos en caché: N / M": photos whose marker is current vs visible photos
 * (of one gallery when `galleryId` is given). Two COUNT queries, no per-photo work.
 */
export async function warmProgress(
  env: Env,
  galleryId?: string,
): Promise<{ warmed: number; total: number }> {
  const db = getDb(env);
  const count = (extra?: SQL) =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(P)
      .innerJoin(G, eq(G.id, P.galleryId))
      .where(
        and(
          eligible,
          galleryId ? eq(P.galleryId, galleryId) : undefined,
          extra,
        ),
      )
      .then((r) => r[0]?.n ?? 0);
  const [total, warmed] = await Promise.all([
    count(),
    count(sql`${P.cacheWarmKey} = ${P.cacheExpectedKey}`),
  ]);
  return { warmed, total };
}
