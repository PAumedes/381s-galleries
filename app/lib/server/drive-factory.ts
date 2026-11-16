import { createDriveClient } from "./drive";
import { createMockDrive } from "./drive-mock";
import type { MockDrive } from "./drive-mock";
import type { DriveClient } from "./drive-types";
import { buildFixtures } from "./fixtures";
import { getAccessToken } from "./google-auth";
import { SETTINGS_KEYS, getSetting } from "./settings";

// One in-memory tree per isolate so mutations and the changes token persist.
let mock: MockDrive | undefined;
let mockRootId: string | undefined;

/** Test hook: drop the in-memory mock tree (and its mutations / changes token). */
export function resetMockDrive(): void {
  mock = undefined;
  mockRootId = undefined;
}

export function getDrive(env: Env): DriveClient {
  if (env.DRIVE_MODE === "mock") {
    mock ??= createMockDrive();
    return mock;
  }
  // The Google OAuth refresh is an external subrequest too: count it so
  // drive.subrequests() (and the sync budget) reflects every external fetch.
  let oauthFetches = 0;
  const client = createDriveClient((force) =>
    getAccessToken(env, {
      forceRefresh: force,
      fetchImpl: (...args) => {
        oauthFetches++;
        return fetch(...args);
      },
    }),
  );
  return {
    ...client,
    subrequests: () => client.subrequests() + oauthFetches,
  };
}

/** Root folder id from settings; in mock mode defaults to the fixtures root. */
export async function getRootFolderId(
  env: Pick<Env, "DB" | "DRIVE_MODE">,
): Promise<string | undefined> {
  const id = await getSetting(env, SETTINGS_KEYS.driveRootId);
  if (id) return id;
  if (env.DRIVE_MODE === "mock") {
    mockRootId ??= buildFixtures().rootId;
    return mockRootId;
  }
  return undefined;
}
