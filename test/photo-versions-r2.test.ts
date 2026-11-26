import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getDb, schema } from "../app/db";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../app/lib/server/drive-types";
import type { MockEntry } from "../app/lib/server/fixtures";
import { deleteGallery } from "../app/lib/server/gallery-delete";
import { runSync } from "../app/lib/server/sync";
import { clearCache } from "./support/cache";
import { migrateDb, resetTables } from "./support/d1";
import { seedVersioned } from "./support/versions";

/** T6.53c: R2 objects of versions >= 2 (`<id>/v<N>/<variant>`) are deleted with their photo, version row and album. */
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const T = "2026-01-01T00:00:00.000Z";
const T0 = new Date("2026-03-01T12:00:00Z");
const after = (min: number) => new Date(T0.getTime() + min * 60_000);
const folder = (id: string, name: string, parentId: string | null) =>
  ({
    id,
    name,
    mimeType: FOLDER_MIME,
    modifiedTime: T,
    parentId,
  }) as MockEntry;
const sync = (names: string[], now: Date) =>
  runSync(e, {
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
    now,
    budget: 200,
  });
const GID = "g1";
const keys = async () =>
  (await env.CACHE.list()).objects.map((o) => o.key).sort();
const put = async (id: string, ...entries: string[]) =>
  Promise.all(
    entries.flatMap((p) =>
      ["thumb", "view-sm", "view-lg"].map((v) =>
        env.CACHE.put(`${id}${p}/${v}`, "x"),
      ),
    ),
  );

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables("settings", "photos", "galleries");
  await clearCache();
  await db
    .insert(schema.settings)
    .values({ key: "drive_root_id", value: "root" });
  await db.insert(schema.galleries).values({
    id: GID,
    driveFolderId: "alb",
    slug: "alb",
    title: "Alb",
    status: "published",
    versioning: true,
  });
});
afterEach(() => vi.restoreAllMocks());

describe("T6.53c sync deletes the R2 keys of versions >= 2", () => {
  it("a version row deleted after its grace takes its v<N> keys; the kept versions stay", async () => {
    await sync(["A.jpg", "A_v2.jpg"], T0);
    const [a] = await db.select().from(schema.photos);
    await put(a.id, "", "/v2");
    await sync(["A.jpg"], after(30)); // v2 marked missing, keys kept
    expect((await keys()).length).toBe(6);
    await sync(["A.jpg"], after(30 + 90)); // grace over: row and keys gone
    expect(await keys()).toEqual(
      ["thumb", "view-lg", "view-sm"].map((v) => `${a.id}/${v}`).sort(),
    );
  });

  it("a removed photo takes every version's keys", async () => {
    await sync(["A.jpg", "A_v2.jpg", "B.jpg"], T0);
    const a = (await db.select().from(schema.photos)).find(
      (p) => p.baseName === "A",
    )!;
    await put(a.id, "", "/v2");
    await sync(["B.jpg"], after(10));
    await sync(["B.jpg"], after(10 + 90));
    expect(await keys()).toEqual([]);
  });

  it("versioning off: a removed photo costs the same single delete call of its 3 keys", async () => {
    await db.update(schema.galleries).set({ versioning: false });
    await sync(["A.jpg", "B.jpg"], T0);
    const a = (await db.select().from(schema.photos)).find(
      (p) => p.baseName === "A",
    )!;
    const del = vi.spyOn(env.CACHE, "delete");
    await sync(["B.jpg"], after(10));
    await sync(["B.jpg"], after(10 + 90));
    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0][0]).toEqual(
      ["thumb", "view-sm", "view-lg"].map((v) => `${a.id}/${v}`),
    );
  });
});

describe("T6.53c gallery delete: R2 calls", () => {
  const M = { ...env, DRIVE_MODE: "mock" } as Env;
  it("versioning off: one delete call per 333 photos, as before", async () => {
    await db.update(schema.galleries).set({ versioning: false });
    for (const id of ["A", "B"]) await seedVersioned(GID, id, [{ n: 1 }]);
    const del = vi.spyOn(env.CACHE, "delete");
    expect(await deleteGallery(M, GID)).toBe("deleted");
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("versioned: version keys go in the same batched calls, the budget is honoured and a resumed run finishes", async () => {
    await seedVersioned(GID, "A", [{ n: 1 }, { n: 2 }, { n: 3 }]);
    await seedVersioned(GID, "B", [{ n: 1 }, { n: 2 }], { sort: 1 });
    await put("A", "", "/v2", "/v3");
    await put("B", "", "/v2");
    // One R2 call per request: needs several requests, each making progress.
    let rounds = 0;
    let out = await deleteGallery(M, GID, { r2CallsMax: 1 });
    while (out === "continue" && rounds++ < 10)
      out = await deleteGallery(M, GID, { r2CallsMax: 1 });
    expect(out).toBe("deleted");
    expect(await keys()).toEqual([]);
    const left = await db
      .select()
      .from(schema.photoVersions)
      .where(eq(schema.photoVersions.galleryId, GID));
    expect(left).toEqual([]);
  });
});
