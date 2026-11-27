import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadWizard } from "../../app/lib/server/admin-wizard";
import { putSetting, SETTINGS_KEYS } from "../../app/lib/server/settings";
import { migrateDb, resetTables } from "../support/d1";

const live = { ...env, DRIVE_MODE: "live", ALLOW_DEV_ADMIN: "1" } as Env;
const run = (s: string, ...b: unknown[]) =>
  env.DB.prepare(s)
    .bind(...b)
    .run();
const add = (id: string, slug: string, status: string, createdAt: string) =>
  run(
    "INSERT INTO galleries (id, drive_folder_id, slug, title, status, created_at) VALUES (?1,?2,?3,?4,?5,?6)",
    id,
    `f-${id}`,
    slug,
    slug,
    status,
    createdAt,
  );

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("photos", "galleries", "clients", "settings");
});

describe("T6.58 adversarial", () => {
  it("step 6 must point at a published gallery when one exists (newest draft hides an older published one)", async () => {
    await putSetting(live, SETTINGS_KEYS.googleRefreshToken, "x");
    await putSetting(live, SETTINGS_KEYS.driveRootName, "S");
    await add("old", "old-pub", "published", "2024-01-01T00:00:00Z");
    await add("new", "new-draft", "draft", "2025-01-01T00:00:00Z");
    const d = await loadWizard(
      new Request("http://localhost/admin/empezar?paso=6"),
      live,
    );
    expect(d.states[4]).toBe("done"); // step 5 says a gallery is published
    expect(d.target?.status).toBe("published"); // but step 6 says "still a draft"
  });
});
