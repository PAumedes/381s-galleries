import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { createDriveClient } from "./drive";
import { createMockDrive } from "./drive-mock";
import type { MockDrive } from "./drive-mock";
import type { DriveClient } from "./drive-types";
import { buildFixtures } from "./fixtures";
import { getAccessToken } from "./google-auth";

export const ROOT_KEY = "drive_root_id";

// One in-memory tree per isolate so mutations and the changes token persist.
let mock: MockDrive | undefined;
let mockRootId: string | undefined;

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
  _drive?: DriveClient,
): Promise<string | undefined> {
  const [row] = await getDb(env as Env)
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, ROOT_KEY));
  if (row?.value) return row.value;
  if (env.DRIVE_MODE === "mock") {
    mockRootId ??= buildFixtures().rootId;
    return mockRootId;
  }
  return undefined;
}
