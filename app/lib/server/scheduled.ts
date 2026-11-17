import type { DriveClient } from "./drive-types";
import { getDrive } from "./drive-factory";
import { runScheduledSync } from "./sync";
import { runScheduledWarm } from "./warm";

/** Cron expression of the cache-warming trigger (wrangler.jsonc `triggers.crons`). */
export const WARM_CRON = "* * * * *";

export interface ScheduledHandlers {
  sync: () => Promise<unknown>;
  warm: () => Promise<unknown>;
}

/**
 * Scheduled handler body: `* * * * *` warms the R2 cache, anything else
 * (the 15-minute trigger) runs the Drive sync.
 */
export async function dispatchScheduled(
  cron: string,
  env: Env,
  handlers?: ScheduledHandlers,
): Promise<void> {
  let drive: DriveClient | undefined;
  const d = () => (drive ??= getDrive(env));
  const h: ScheduledHandlers = handlers ?? {
    sync: () => runScheduledSync(env, d()),
    warm: () => runScheduledWarm(env, d()),
  };
  if (cron.trim() === WARM_CRON) await h.warm();
  else await h.sync();
}
