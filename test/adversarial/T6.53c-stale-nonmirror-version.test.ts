import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { staleRows } from "../../app/lib/server/warm-stale";
import { markWarmed } from "../../app/lib/server/warm-key";
import {
  atLatestVersion,
  loadGalleryVersions,
} from "../../app/lib/server/photo-versions";
import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";
import { modified, seedVersioned } from "../support/versions";

const G = "gggggggg-0000-0000-0000-0000000000f1";
const db = getDb(env);

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables(
    "settings",
    "photo_versions",
    "delivery_rounds",
    "photos",
    "galleries",
  );
  await clearCache();
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "s",
    title: "t",
    status: "published",
    versioning: true,
    mode: "proofing",
  });
});

describe("T6.53c cron stale scan follows the SHOWN version, not the mirror", () => {
  it("replacing the file of the shown (fallback) version makes the photo stale again", async () => {
    // v2 has no preview-wm => Prueba shows v1; photos mirrors v2.
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2, wm: false }]);
    const live = await loadGalleryVersions(env, G);
    const [p] = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.id, "A"));
    const shown = atLatestVersion(p, live.get("A"), true);
    expect(shown.version).toBe(1);
    await markWarmed(env, shown, true);
    expect((await staleRows(env)).rows).toHaveLength(0);
    // The designer re-exports v1's preview-wm: its Drive modified time changes.
    await db
      .update(schema.photoVersions)
      .set({
        driveVersions: modified(1).replace(
          "2026-03-01T00:00:04Z",
          "2026-04-01T00:00:04Z",
        ),
      })
      .where(eq(schema.photoVersions.photoId, "A"));
    // (the photos row is untouched: it mirrors v2, so no trigger resets the key)
    const stale = await staleRows(env);
    expect(stale.rows.map((r) => r.photo.id)).toEqual(["A"]);
  });
});
