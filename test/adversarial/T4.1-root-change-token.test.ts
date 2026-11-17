import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../../app/lib/server/drive-types";
import type { DriveClient } from "../../app/lib/server/drive-types";
import { setupAction } from "../../app/routes/admin.setup";
import { runSync } from "../../app/lib/server/sync";
import { buildFixtures } from "../../app/lib/server/fixtures";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;

beforeAll(async () => {
  await applyD1Migrations(
    env.DB,
    (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
  );
});

describe("T4.1 changing the root folder", () => {
  it("next non-forced (cron) sync after a root change must rescan, not say 'unchanged'", async () => {
    await getDb(e).delete(schema.galleries);
    await getDb(e).delete(schema.settings);
    const drive = createMockDrive();
    const root = buildFixtures().rootId;
    await runSync(e, { drive });
    const other = "1NewRootFolderIdAbcdef12345";
    const stub: DriveClient = {
      ...drive,
      getMeta: async () => ({
        id: other,
        name: "Other",
        mimeType: FOLDER_MIME,
        modifiedTime: "2026-01-01T00:00:00Z",
      }),
    };
    expect(root).not.toBe(other);
    const r = await setupAction(
      new Request("http://localhost/admin/setup", {
        method: "POST",
        body: new URLSearchParams({ intent: "root", folder: other }),
      }),
      e,
      stub,
    );
    expect(r.ok).toBe(true);
    const next = await runSync(e, { drive: stub });
    expect(next.skipped).not.toBe("unchanged");
  });
});
