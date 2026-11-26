import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { deleteGallery } from "../../app/lib/server/gallery-delete";
import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";
import { seedVersioned } from "../support/versions";

const G = "gggggggg-0000-0000-0000-0000000000e1";
const e = { ...env, DRIVE_MODE: "mock" } as Env;

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables(
    "photo_versions",
    "delivery_rounds",
    "photos",
    "galleries",
    "settings",
    "ignored_folders",
  );
  await clearCache();
  await getDb(env).insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "orph",
    title: "t",
    status: "published",
    versioning: true,
  });
});

describe("T6.53c R2 objects of versions >= 2 survive gallery deletion", () => {
  it("deleting a gallery leaves no R2 key of the photo", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    for (const k of ["A/thumb", "A/v2/thumb", "A/v2/view-lg"])
      await env.CACHE.put(k, "x");
    expect(await deleteGallery(e, G)).toBe("deleted");
    const left = (await env.CACHE.list()).objects.map((o) => o.key);
    expect(left).toEqual([]);
  });
});
