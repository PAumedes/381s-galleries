import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { getDb, schema } from "../../app/db";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../../app/lib/server/drive-types";
import type { MockEntry } from "../../app/lib/server/fixtures";
import { runSync } from "../../app/lib/server/sync";
import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";

// T6.55b: on main an R2 outage never stopped a sync (failed deletes just stay
// in r2_pending_deletes). Now, once the pending list is near its cap, ONE
// removal makes runSync throw: a brand new album (and every later one) is not
// synced and the Drive change token is not advanced while R2 is down.
const M = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const T = "2026-01-01T00:00:00.000Z";
const T0 = new Date("2026-03-01T12:00:00Z");
const folder = (id: string, name: string, parentId: string | null) =>
  ({ id, name, mimeType: FOLDER_MIME, modifiedTime: T, parentId }) as MockEntry;
const jpg = (parent: string, name: string): MockEntry => ({
  id: `${parent}/${name}`,
  name,
  mimeType: "image/jpeg",
  modifiedTime: T,
  parentId: parent,
  width: 2000,
  height: 1000,
  size: 1000,
});

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("settings", "photos", "galleries", "photo_versions");
  await clearCache();
  await db.insert(schema.settings).values([
    { key: "drive_root_id", value: "root" },
    {
      key: "r2_pending_deletes",
      value: JSON.stringify(Array.from({ length: 1999 }, (_, i) => `s${i}`)),
    },
  ]);
  await db.insert(schema.galleries).values({
    id: "g1",
    driveFolderId: "alb",
    slug: "alb",
    title: "Alb",
    status: "published",
  });
  await env.DB.prepare(
    "INSERT INTO photos (id, gallery_id, base_name, sort, drive_highres_id, missing_since) VALUES ('GONE1','g1','GONE1',0,'h',?1), ('GONE2','g1','GONE2',1,'h',?1)",
  )
    .bind(T)
    .run();
});
afterEach(() => vi.restoreAllMocks());

it("an R2 outage does not stop the sync of other albums", async () => {
  vi.spyOn(env.CACHE, "delete").mockRejectedValue(new Error("r2 down"));
  const r = await runSync(M, {
    drive: createMockDrive({
      rootId: "root",
      entries: [
        folder("root", "root", null),
        folder("alb", "Alb", "root"),
        folder("hr", "high-res", "alb"),
        jpg("hr", "Z.jpg"),
        folder("alb2", "Second", "root"),
        folder("hr2", "high-res", "alb2"),
        jpg("hr2", "N.jpg"),
      ],
    }),
    force: true,
    now: T0,
    budget: 200,
  }).catch((e: unknown) => e);
  expect(r).not.toBeInstanceOf(Error);
  expect(
    (await db.select().from(schema.galleries))
      .map((g) => g.driveFolderId)
      .sort(),
  ).toEqual(["alb", "alb2"]);
});
