/** Forced sync followed by the background warm of what it changed (T6.39). */
import type { D1Meter } from "./d1-meter";
import type { DriveClient } from "./drive-types";
import { runRecordedSync } from "./sync";
import type { SyncResult } from "./sync-types";
import { scheduleWarmAfterSync } from "./warm-after-sync";

/**
 * `meter` counts the invocation's D1 queries so far; the warm gets only what
 * is left of the Free 50 (and of the 50 subrequests the sync did not use).
 */
export async function syncThenWarm(
  meter: D1Meter,
  drive: DriveClient,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<SyncResult> {
  const result = await runRecordedSync(meter.env, { drive, force: true });
  scheduleWarmAfterSync(meter.env, { ctx, drive }, result, meter.used());
  return result;
}
