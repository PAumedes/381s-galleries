/**
 * Cloudflare limits the sync code is written against. Any batching constant
 * must stay within the FREE plan values here so the same code is safe on both
 * plans (test/d1-limits.test.ts fails if a statement or batch exceeds them).
 *
 * Workers Free: 50 subrequests (Drive/OAuth fetches) AND 50 D1 queries per
 * invocation; Workers Paid raises the query count to 1000 (subrequests too).
 * Both: 100 bound parameters per D1 statement.
 *
 * Consequences: per-statement shape (below) is plan-independent. The NUMBER of
 * queries per run is not: a big library can need more than 50 on Free, in which
 * case the run fails and the next run re-diffs from the last committed state
 * (docs/SELF-HOSTING.md, "too many subrequests" -> Workers Paid). Sync's own
 * cap (CF_SUBREQUEST_CAP in sync.ts, 900) targets Paid and is unchanged.
 */
export const D1_MAX_BOUND_PARAMS = 100;
export const D1_FREE_QUERIES_PER_INVOCATION = 50;
export const D1_PAID_QUERIES_PER_INVOCATION = 1000;
/** Ids per `IN (...)` list: one bound parameter each, under the 100 cap. */
export const D1_IN_CHUNK = 90;
/** Rows per multi-row photo INSERT: ~18 bound columns each, 5 * 18 = 90 <= 100. */
export const PHOTO_INSERT_ROWS = 5;
/** Statements per db.batch() call (one D1 round trip). */
export const D1_BATCH_MAX = 100;
