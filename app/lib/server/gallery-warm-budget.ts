/** What one warm run may spend (Drive subrequests and D1 queries) and how it is metered. */
import { meterD1 } from "./d1-meter";
import type { D1Allowance } from "./d1-meter";
import type { DriveClient } from "./drive-types";

/** External (Drive + OAuth) subrequests one open may spend; Workers Free allows 50 per invocation. */
export const OPEN_WARM_BUDGET = 36;
/** Worst case of ONE Drive call: the file, 3 retries and an OAuth refresh. */
export const CALL_RESERVE = 3 + 2;
/**
 * What one run may spend: Drive subrequests from `start` (`budget`), and
 * optionally D1 queries (`d1.used()` counts them all, `d1.budget` is the cap).
 * Without `d1` the run is bounded by the Drive budget alone.
 */
export interface Allowance {
  start: number;
  budget: number;
  d1?: D1Allowance;
}

/** D1 queries one more page of a versioned album costs beyond the page select: its version rows (T6.53c). */
export const VERSIONED_PAGE_D1_QUERIES = 1;

/** `VERSIONED_PAGE_D1_QUERIES` for a versioned gallery, 0 otherwise. */
export const versionedExtra = (g: { versioning: boolean }): number =>
  g.versioning ? VERSIONED_PAGE_D1_QUERIES : 0;

/** Worst case of D1 queries for one photo: a gate check per Drive call (2) + the marker (1) + the next page select (1). */
export const PHOTO_D1_RESERVE = 4;
/** D1 queries kept for ending the run: the cursor save and the marker clear. */
const FINISH_D1_RESERVE = 2;

/** True when the D1 budget cannot cover one more step plus ending the run cleanly. */
export function d1Exhausted(
  span: Allowance,
  extra = PHOTO_D1_RESERVE,
): boolean {
  return (
    !!span.d1 && span.d1.used() + extra + FINISH_D1_RESERVE > span.d1.budget
  );
}

/** `baseEnv` with every D1 query counted, and the allowance that caps the run. */
export function metered(
  baseEnv: Env,
  drive: DriveClient,
  budget: number,
  d1Budget: number,
): { env: Env; span: Allowance } {
  const meter = meterD1(baseEnv);
  return {
    env: meter.env,
    span: {
      start: drive.subrequests(),
      budget,
      d1: { used: meter.used, budget: d1Budget },
    },
  };
}
