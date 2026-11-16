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
