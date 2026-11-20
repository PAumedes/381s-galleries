import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db";

/** Every `settings` key the app uses (PLAN section 4). */
export const SETTINGS_KEYS = {
  driveRootId: "drive_root_id",
  googleRefreshToken: "google_refresh_token",
  googleAccessToken: "google_access_token",
  /** Prefix: one row per consumed OAuth state nonce. */
  oauthStateUsedPrefix: "oauth_state_used:",
  driveChangesToken: "drive_changes_token",
  syncLock: "sync_lock",
  r2PendingDeletes: "r2_pending_deletes",
  syncLastError: "sync_last_error",
  /** ISO time of the last successful sync (cron or admin button). */
  syncLastOk: "sync_last_ok",
  /** Display name of the saved root folder (never the id). */
  driveRootName: "drive_root_name",
  /** Studio name override (admin setup); env STUDIO_NAME is the fallback. */
  studioName: "studio_name",
  /** Uploaded logo metadata `{t: type, v: version}` per variant (file in R2 under brand/). */
  logoOnLight: "logo_on_light",
  logoOnDark: "logo_on_dark",
  /** Cache-warm lock `<iso>|<uuid>` (expiry + owner), like sync_lock. */
  warmLock: "warm_lock",
  /** ISO time until which the warm cron skips its scan (nothing was stale). */
  warmIdle: "warm_idle",
  /** Random value bumped by DB triggers whenever photos/watermark change (see migration 0012). */
  warmStamp: "warm_stamp",
  /** Prefix: one row per gallery, `<phase>:<offset>:<warm_stamp>` or `done:<warm_stamp>` (gallery-warm.ts). */
  warmCursorPrefix: "warm_cursor:",
} as const;

type SettingsEnv = Pick<Env, "DB">;

export async function getSetting(
  env: SettingsEnv,
  key: string,
): Promise<string | undefined> {
  const [r] = await getDb(env as Env)
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key));
  return r?.value;
}

export async function putSetting(
  env: SettingsEnv,
  key: string,
  value: string,
): Promise<void> {
  await getDb(env as Env)
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

export async function deleteSetting(
  env: SettingsEnv,
  key: string,
): Promise<void> {
  await getDb(env as Env)
    .delete(schema.settings)
    .where(eq(schema.settings.key, key));
}
