import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "../app/db";
import { imageVersionToken } from "../app/lib/server/images";
import { buildOpenData } from "../app/lib/server/gallery-open-data";
import {
  SLUG_LOADER_D1_QUERIES,
  VERSIONED_OPEN_D1_QUERIES,
} from "../app/lib/server/d1-limits";
import { loadGallery } from "../app/lib/server/gallery";
import { migrateDb, resetTables } from "./support/d1";
import { countingEnv, noRatePrune } from "./support/warm";
import { files, modified, seedVersioned } from "./support/versions";

const db = getDb(env);
const G = "gggggggg-0000-0000-0000-0000000000c1";

beforeAll(async () => {
  await migrateDb();
});
beforeEach(async () => {
  await resetTables(
    "gallery_views",
    "photo_versions",
    "delivery_rounds",
    "photos",
    "galleries",
  );
  noRatePrune();
  return () => vi.restoreAllMocks();
});

async function addGallery(over: Partial<typeof schema.galleries.$inferInsert>) {
  await db.insert(schema.galleries).values({
    id: G,
    driveFolderId: "f",
    slug: "retoque",
    title: "Retoque",
    status: "published",
    versioning: true,
    ...over,
  });
}
async function open(e: Env = env) {
  const [g] = await db
    .select()
    .from(schema.galleries)
    .where(eq(schema.galleries.id, G));
  return buildOpenData(e, g);
}
const photo = (d: Awaited<ReturnType<typeof open>>, id: string) =>
  d.photos.find((p) => p.id === id)!;

describe("T6.53c public latest-version view (buildOpenData)", () => {
  it("shows the latest version: token, size and history of a photo with v1 and v2", async () => {
    await addGallery({});
    await seedVersioned(G, "A", [
      { n: 1, width: 3000, height: 2000 },
      { n: 2, width: 2000, height: 3000, at: "2026-02-05T10:00:00.000Z" },
    ]);
    const d = await open();
    const p = photo(d, "A");
    expect(p).toMatchObject({ ver: 2, width: 2000, height: 3000 });
    expect(p.versions).toEqual([
      {
        n: 1,
        round: null,
        at: "2026-02-01T10:00:00.000Z",
        v: expect.any(String),
      },
      { n: 2, round: 2, at: "2026-02-05T10:00:00.000Z", v: expect.any(String) },
    ]);
    // The photo's own token is the v2 file's, and differs from v1's.
    const [row] = await db.select().from(schema.photos);
    expect(p.v).toBe(await imageVersionToken(env, row, false));
    expect(p.versions![0].v).not.toBe(p.versions![1].v);
    expect(p.versions![1].v).toBe(p.v);
  });

  it("badge: only versions of the newest round are new; the album header carries that round", async () => {
    await addGallery({});
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]); // round 2
    await seedVersioned(G, "B", [{ n: 1 }, { n: 2 }, { n: 3 }], { sort: 1 }); // round 3
    await seedVersioned(G, "C", [{ n: 1 }], { sort: 2 }); // never resent
    const d = await open();
    expect(d.gallery.round).toBe(3);
    expect(photo(d, "A").isNew).toBeUndefined();
    expect(photo(d, "B")).toMatchObject({ ver: 3, isNew: true });
    expect(photo(d, "C").isNew).toBeUndefined();
    expect(photo(d, "C").ver).toBeUndefined();
    expect(photo(d, "C").versions).toBeUndefined();
  });

  it("no round yet (only v1 rows): no round, no badge, no history", async () => {
    await addGallery({});
    await seedVersioned(G, "A", [{ n: 1 }]);
    const d = await open();
    expect(d.gallery.round).toBeUndefined();
    expect(photo(d, "A")).not.toHaveProperty("versions");
    expect(photo(d, "A")).not.toHaveProperty("isNew");
  });

  it("ignores version rows whose file left Drive (missingSince)", async () => {
    await addGallery({});
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2, missing: true }]);
    const d = await open();
    expect(d.gallery.round).toBeUndefined();
    expect(photo(d, "A")).not.toHaveProperty("ver");
    expect(photo(d, "A")).not.toHaveProperty("versions");
    const [row] = await db.select().from(schema.photos);
    expect(photo(d, "A").v).toBe(await imageVersionToken(env, row, false));
  });

  it("the token follows the modified time of the latest version's files", async () => {
    await addGallery({});
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const before = photo(await open(), "A").v;
    await db
      .update(schema.photoVersions)
      .set({ driveVersions: modified(9) })
      .where(eq(schema.photoVersions.version, 2));
    expect(photo(await open(), "A").v).not.toBe(before);
  });

  it("an album with versioning off ignores photo_versions rows (stale backfill) and the payload has no version fields", async () => {
    await addGallery({ versioning: false });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const d = await open();
    const p = photo(d, "A");
    expect(Object.keys(p).sort()).toEqual(
      ["height", "id", "set", "v", "variants", "width"].sort(),
    );
    expect(d.gallery.round).toBeUndefined();
    expect(Object.keys(d.gallery)).not.toContain("round");
  });

  it("never carries Drive ids", async () => {
    await addGallery({});
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }, { n: 3 }]);
    const json = JSON.stringify(await open());
    expect(json).not.toMatch(/(HI|WEB|TH|WM|TWM)-A-v/);
    expect(json).not.toMatch(/round-/);
  });
});

describe("T6.53c Prueba: every version needs its own preview-wm", () => {
  it("falls back to the newest version that has one; history lists only those", async () => {
    await addGallery({ mode: "proofing" });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }, { n: 3, wm: false }]);
    const p = photo(await open(), "A");
    expect(p.ver).toBe(2);
    expect(p.versions!.map((v) => v.n)).toEqual([1, 2]);
    const [row] = await db.select().from(schema.photos);
    expect(row.driveWmId).toBeNull(); // the mirror is v3, without wm
    // The token is the one /img will compute for v2 (preview-wm files).
    const v2 = {
      ...row,
      ...files("A", 2),
      variantVersions: modified(2),
    };
    expect(p.v).toBe(await imageVersionToken(env, v2, true));
  });

  it("a photo whose only servable version is v1 shows v1 without history or badge", async () => {
    await addGallery({ mode: "proofing" });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2, wm: false }]);
    const d = await open();
    const p = photo(d, "A");
    expect(p).not.toHaveProperty("versions");
    expect(p).not.toHaveProperty("isNew");
    expect(d.gallery.round).toBeUndefined();
  });

  it("the header round only counts versions that are shown", async () => {
    await addGallery({ mode: "proofing" });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]); // round 2
    await seedVersioned(G, "B", [{ n: 1 }, { n: 2 }, { n: 3, wm: false }], {
      sort: 1,
    }); // round 3 hidden
    const d = await open();
    expect(d.gallery.round).toBe(2);
    expect(photo(d, "A").isNew).toBe(true);
    expect(photo(d, "B").isNew).toBe(true);
  });

  it("no version has a preview-wm: the photo stays listed like before (no clean file is chosen)", async () => {
    await addGallery({ mode: "proofing" });
    await seedVersioned(G, "A", [
      { n: 1, wm: false },
      { n: 2, wm: false },
    ]);
    const d = await open();
    expect(d.photos).toHaveLength(1);
    expect(photo(d, "A")).not.toHaveProperty("v");
  });
});

describe("T6.53c D1 budget of the gallery open path", () => {
  it("a versioned album costs exactly VERSIONED_OPEN_D1_QUERIES more than an unversioned one", async () => {
    await addGallery({ versioning: false });
    await seedVersioned(G, "A", [{ n: 1 }, { n: 2 }]);
    const off = countingEnv(env);
    await open(off.e);
    await db
      .update(schema.galleries)
      .set({ versioning: true })
      .where(eq(schema.galleries.id, G));
    const on = countingEnv(env);
    await open(on.e);
    expect(VERSIONED_OPEN_D1_QUERIES).toBe(1);
    expect(on.count() - off.count()).toBe(VERSIONED_OPEN_D1_QUERIES);
    expect(off.count()).toBe(1);
  });

  it("the slug loader of a versioned album stays inside SLUG_LOADER_D1_QUERIES", async () => {
    await addGallery({});
    for (let i = 0; i < 6; i++)
      await seedVersioned(G, `P${i}`, [{ n: 1 }, { n: 2 }], { sort: i });
    const loader = countingEnv(env);
    const res = await loadGallery(
      new Request("http://x.test/retoque", {
        headers: {
          "CF-Connecting-IP": "203.0.113.9",
          "Sec-Fetch-Mode": "navigate",
        },
      }),
      "retoque",
      loader.e,
    );
    expect(res.data.state).toBe("open");
    expect(loader.count()).toBeLessThanOrEqual(SLUG_LOADER_D1_QUERIES);
  });
});

describe("T6.53c a stale v1 row from the unversioned era", () => {
  it("open data uses the up-to-date photos columns until the sync re-derives the row", async () => {
    await addGallery({});
    await seedVersioned(G, "A", [{ n: 1 }]);
    await db
      .update(schema.photos)
      .set({ driveThumbId: "TH-NEW", variantVersions: modified(5) });
    const [row] = await db.select().from(schema.photos);
    const p = (await open()).photos[0];
    expect(p.v).toBe(await imageVersionToken(env, row, false));
    expect(p).not.toHaveProperty("ver");
  });
});
