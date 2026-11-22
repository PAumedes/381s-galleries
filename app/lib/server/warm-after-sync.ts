import type { DriveClient } from "./drive-types";
import type { SyncResult } from "./sync";
import type { OpenWarmResult } from "./gallery-warm";
export async function warmPendingGalleries(
  _env: Env,
  _drive: DriveClient,
  _o?: { budget?: number },
): Promise<OpenWarmResult> {
  return { warmed: 0, failed: 0 };
}
export function scheduleWarmAfterSync(
  _env: Env,
  _d: unknown,
  _r: SyncResult,
): void {}
export async function runWarmCron(_e: Env, _d: DriveClient): Promise<void> {}
