import { migrateDb, resetTables } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { activityQuery } from "../app/lib/server/activity";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000a1";
const G2 = "gggggggg-0000-0000-0000-0000000000a2";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables("downloads", "visitors", "photos", "galleries");
});

describe("activityQuery", () => {
  it("returns per-photo download rows with visitor email (null for anon) plus bulk headers, scoped to the gallery", async () => {
    for (const [id, slug] of [
      [G, "a"],
      [G2, "b"],
    ]) {
      await db.insert(schema.galleries).values({
        id,
        driveFolderId: "f" + id,
        slug,
        title: slug,
        status: "published",
      });
      await db.insert(schema.photos).values({
        id: "p-" + id,
        galleryId: id,
        baseName: "IMG",
        driveHighresId: "h" + id,
        sort: 1,
      });
    }
    await db.insert(schema.visitors).values([
      { id: "v1", galleryId: G, email: "ana@example.com" },
      { id: "v2", galleryId: G, email: "anon-123@anon.invalid" },
      { id: "v3", galleryId: G2, email: "other@example.com" },
    ]);
    const row = (
      id: string,
      photoId: string | null,
      visitorId: string,
      kind: "single" | "bulk",
      galleryId = G,
    ) => ({
      id,
      galleryId,
      photoId,
      visitorId,
      variant: "web" as const,
      kind,
      createdAt: "2026-01-01T00:00:0" + id.slice(-1) + "Z",
    });
    await db
      .insert(schema.downloads)
      .values([
        row("d1", "p-" + G, "v1", "single"),
        row("d2", "p-" + G, "v2", "bulk"),
        row("d3", null, "v2", "bulk"),
        row("d4", "p-" + G2, "v3", "single", G2),
      ]);
    const rows = await activityQuery(db, G);
    expect(rows.map((r) => r.id).sort()).toEqual(["d1", "d2", "d3"]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.d1).toMatchObject({ email: "ana@example.com", kind: "single" });
    expect(by.d2.email).toBeNull();
    expect(by.d3).toMatchObject({ photoId: null, kind: "bulk", email: null });
    expect(by.d1.photoId).toBe("p-" + G);
  });
});
