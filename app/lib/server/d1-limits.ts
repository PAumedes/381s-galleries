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

/** Workers Free: external subrequests (Drive/OAuth fetches) per invocation. */
export const FREE_SUBREQUESTS_PER_INVOCATION = 50;
/** Left unspent in an invocation that runs a warm (host-side reads, OAuth refresh, retries). */
export const INVOCATION_SAFETY = 5;
/**
 * D1 queries a warm-after-sync run may spend at most (T6.39). Every query of
 * the run is counted (d1-meter.ts), not only Drive-backed steps. In the admin
 * sync's waitUntil it shares the Free 50 with the sync itself, whose queries
 * the route measures: budget = min(30, 50 - INVOCATION_SAFETY - sync's own),
 * not started below 16. A 2-album/12-photo sync uses about 21, so the warm gets
 * 24; a sync that used 30+ gets no background warm and the minute cron
 * continues (its own invocation: 45 for the stale scan plus pending marks).
 */
export const AFTER_SYNC_WARM_D1_BUDGET = 30;
