import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { getDb, schema } from "../../app/db";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../../app/lib/server/drive-types";
import type { MockEntry } from "../../app/lib/server/fixtures";
import { runSync } from "../../app/lib/server/sync";
import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";

// T6.55b: on main a removal costs ONE batch no matter how many photos go
// (up to 100 statements per batch). The rework reads photo_versions in
// 90-id chunks BEFORE the batch, so D1 queries grow with the removed count
// and a run that removes ~4500 photos would pass the Workers Free 50-query
// limit (d1-limits.ts) and, being read-before-write, never make progress.
const M = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const T = "2026-01-01T00:00:00.000Z";
const T0 = new Date("2026-03-01T12:00:00Z");
const folder = (id: string, name: string, parentId: string | null) =>
  ({ id, name, mimeType: FOLDER_MIME, modifiedTime: T, parentId }) as MockEntry;
const sync = (names: string[]) =>
  runSync(M, {
    drive: createMockDrive({
      rootId: "root",
      entries: [
        folder("root", "root", null),
        folder("alb", "Alb", "root"),
        folder("hr", "high-res", "alb"),
        ...names.map((name): MockEntry => ({
          id: `hr/${name}`,
          name,
          mimeType: "image/jpeg",
          modifiedTime: T,
          parentId: "hr",
          width: 2000,
          height: 1000,
          size: 1000,
        })),
      ],
    }),
    force: true,
    now: T0,
    budget: 200,
  });

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("settings", "photos", "galleries", "photo_versions");
  await clearCache();
  await db
    .insert(schema.settings)
    .values({ key: "drive_root_id", value: "root" });
  await db.insert(schema.galleries).values({
    id: "g1",
    driveFolderId: "alb",
    slug: "alb",
    title: "Alb",
    status: "published",
    versioning: false,
  });
});
afterEach(() => vi.restoreAllMocks());

const removeN = async (n: number) => {
  const rows: D1PreparedStatement[] = [];
  for (let i = 0; i < n; i++)
    rows.push(
      env.DB.prepare(
        "INSERT INTO photos (id, gallery_id, base_name, sort, drive_highres_id, missing_since) VALUES (?1, ?2, ?1, ?3, 'h', ?4)",
      ).bind(`P${i}`, "g1", i, T),
    );
  for (let i = 0; i < rows.length; i += 500)
    await env.DB.batch(rows.slice(i, i + 500));
  const prep = vi.spyOn(env.DB, "prepare");
  await sync(["Z.jpg"]);
  const total = prep.mock.calls.length;
  const versionReads = prep.mock.calls.filter((c) =>
    /from "photo_versions"/i.test(String(c[0])),
  ).length;
  prep.mockRestore();
  return { total, versionReads };
};

it("removing many photos costs a bounded number of photo_versions reads (not one per 90 photos)", async () => {
  const { versionReads } = await removeN(2700);
  expect(versionReads).toBeLessThanOrEqual(2);
}, 120_000);
