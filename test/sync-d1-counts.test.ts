import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { meterD1 } from "../app/lib/server/d1-meter";
import { FOLDER_MIME } from "../app/lib/server/drive-types";
import type { MockEntry } from "../app/lib/server/fixtures";
import { runSync } from "../app/lib/server/sync";

/**
 * Characterization (T6.53b): the D1 queries (one per prepared statement, as
 * Workers Free meters them, d1-limits.ts) of a plain album sync. Versioning
 * is off by default, so these counts must not move when the version parser is
 * added; the `_v2` names below stay plain photos.
 */
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const T = "2026-01-01T00:00:00.000Z";
const ROOT = "root";
const NOW = new Date("2026-03-01T12:00:00Z");

const folder = (id: string, name: string, parentId: string): MockEntry => ({
  id,
  name,
  mimeType: FOLDER_MIME,
  modifiedTime: T,
  parentId,
});
const jpg = (
  id: string,
  name: string,
  parentId: string,
  modifiedTime = T,
): MockEntry => ({
  id,
  name,
  mimeType: "image/jpeg",
  modifiedTime,
  parentId,
  width: 2000,
  height: 1000,
});

function drive(changed: boolean) {
  return createMockDrive({
    rootId: ROOT,
    entries: [
      { ...folder(ROOT, "root", ""), parentId: null },
      folder("alpha", "Alpha", ROOT),
      folder("a-hr", "high-res", "alpha"),
      jpg("a1", "IMG_1.jpg", "a-hr", changed ? "2026-02-01T00:00:00.000Z" : T),
      jpg("a2", "IMG_1_v2.jpg", "a-hr"),
      ...(changed ? [jpg("a3", "IMG_3.jpg", "a-hr")] : []),
      folder("a-web", "web", "alpha"),
      jpg("a1w", "IMG_1.jpg", "a-web"),
      folder("beta", "Beta", ROOT),
      folder("b-hr", "high-res", "beta"),
      jpg("b1", "B1.jpg", "b-hr"),
    ],
  });
}

beforeAll(migrateDb);
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.delete(schema.settings);
  await db
    .insert(schema.settings)
    .values({ key: "drive_root_id", value: ROOT });
});

describe("T6.53b D1 query counts of a versioning=0 sync (pinned before the parser)", () => {
  it("first sync, unchanged forced re-sync, changed re-sync", async () => {
    const counts: number[] = [];
    for (const [changed, now] of [
      [false, NOW],
      [false, new Date(NOW.getTime() + 60_000)],
      [true, new Date(NOW.getTime() + 120_000)],
    ] as const) {
      const m = meterD1(e);
      await runSync(m.env, {
        drive: drive(changed),
        force: true,
        now,
        budget: 100,
      });
      counts.push(m.used());
    }
    expect(counts).toEqual([15, 10, 14]);
    expect((await db.select().from(schema.photos)).length).toBe(4);
  });
});
