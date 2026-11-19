import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  SETTINGS_KEYS,
  deleteSetting,
  getSetting,
  putSetting,
} from "../app/lib/server/settings";

beforeAll(async () => {
  await migrateDb();
});

describe("settings helpers", () => {
  it("get/put/delete roundtrip with upsert", async () => {
    expect(await getSetting(env, "t_key")).toBeUndefined();
    await putSetting(env, "t_key", "a");
    await putSetting(env, "t_key", "b");
    expect(await getSetting(env, "t_key")).toBe("b");
    await deleteSetting(env, "t_key");
    expect(await getSetting(env, "t_key")).toBeUndefined();
  });
  it("exposes the documented keys", () => {
    expect(SETTINGS_KEYS).toMatchObject({
      driveRootId: "drive_root_id",
      googleRefreshToken: "google_refresh_token",
      googleAccessToken: "google_access_token",
      driveChangesToken: "drive_changes_token",
      syncLock: "sync_lock",
      r2PendingDeletes: "r2_pending_deletes",
      syncLastError: "sync_last_error",
    });
    expect(SETTINGS_KEYS.oauthStateUsedPrefix).toBe("oauth_state_used:");
  });
});
