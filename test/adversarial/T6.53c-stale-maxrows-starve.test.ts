import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../../app/db";
import { staleRows } from "../../app/lib/server/warm-stale";
import { migrateDb, resetTables } from "../support/d1";
import { seedVersioned } from "../support/versions";

const G = "gggggggg-0000-0000-0000-0000000000f2";

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
  await getDb(env).insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "s",
    title: "t",
    status: "published",
    versioning: true,
  });
});

describe("T6.53c stale scan with a tiny D1 allowance", () => {
  it("maxRows=1 still makes progress on a versioned stale photo (version lookup must not eat the whole allowance)", async () => {
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const r = await staleRows(env, 1);
    expect(r.rows.length).toBeGreaterThan(0);
  });
});
