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
/** Rows per multi-row photo INSERT: 17 bound columns each (T6.53d added drive_tiff_id), 5 * 17 = 85 <= 100. */
export const PHOTO_INSERT_ROWS = 5;
/** Rows per multi-row photo_versions INSERT: 16 bound columns each (T6.53d added drive_tiff_id), 6 * 16 = 96 <= 100. */
export const VERSION_INSERT_ROWS = 6;
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

/**
 * D1 queries the `$slug` loader makes itself before it hands the warm-on-open
 * to `waitUntil` (loadGallery: gallery lookup, grid data, view log; 3 measured, padded for
 * the other paths; the bound is asserted by test/warm-d1-budget.test.ts).
 */
export const SLUG_LOADER_D1_QUERIES = 8;
/**
 * Extra D1 queries the gallery open path makes for an album with
 * `galleries.versioning = 1` (T6.53c): one join of its version rows with their
 * round numbers. Unversioned albums make none, so they keep SLUG_LOADER_D1_QUERIES
 * as it was (3 measured + this = 4, inside the padded 8; test/photo-versions-public.test.ts).
 */
export const VERSIONED_OPEN_D1_QUERIES = 1;
/**
 * Extra D1 queries the visitor's favorites list makes for an album with
 * `galleries.versioning = 1` (T6.53f): one read of the visitor's own approvals
 * (served by `photo_approvals_gallery_visitor_idx`). Unversioned albums make
 * none and their response is byte-identical (no `approvals` key). The open
 * payload itself stays cacheable and unchanged: approvals are per visitor, so
 * they ride on the per-visitor favorites call, never on the page.
 */
export const VERSIONED_APPROVALS_D1_QUERIES = 1;
/** D1 queries a client homepage `/:client` makes (T6.40e): album lookup that finds nothing, albums + client in one join, covers; asserted by test/client-page.test.ts. */
export const CLIENT_PAGE_D1_QUERIES = 3;
/** D1 queries the admin `status` action makes itself (gallery, deleting check, compare-and-set; 3 measured, padded; asserted by the same test). */
export const PUBLISH_ACTION_D1_QUERIES = 6;
/** D1 queries warm-on-open may spend: the Free 50 minus safety minus the loader's own. */
export const OPEN_WARM_D1_BUDGET =
  D1_FREE_QUERIES_PER_INVOCATION - INVOCATION_SAFETY - SLUG_LOADER_D1_QUERIES;
/** D1 queries warm-at-publish may spend: the Free 50 minus safety minus the action's own. */
export const PUBLISH_WARM_D1_BUDGET =
  D1_FREE_QUERIES_PER_INVOCATION -
  INVOCATION_SAFETY -
  PUBLISH_ACTION_D1_QUERIES;
