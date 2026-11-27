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
import { galleryAction } from "../app/lib/server/admin-galleries";
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
const keys = async () => {
  const out: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.CACHE.list({ cursor });
    out.push(...page.objects.map((o) => o.key));
    if (!page.truncated) return out.sort();
    cursor = page.cursor;
  }
};
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

describe("T6.55 R2 objects of versions >= 2 never outlive the album, whatever the versioning flag says", () => {
  const M = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
  beforeEach(() =>
    resetTables("photo_versions", "delivery_rounds", "ignored_folders"),
  );
  const seedOff = async () => {
    await seedVersioned(GID, "A", [{ n: 1 }, { n: 2 }, { n: 3 }]);
    await seedVersioned(GID, "B", [{ n: 1 }, { n: 2, missing: true }], {
      sort: 1,
    });
    await put("A", "", "/v2", "/v3");
    await put("B", "", "/v2");
    await db.update(schema.galleries).set({ versioning: false });
  };

  it("deleteGallery with versioning off (switched off after v2+ existed) removes every v<N> key", async () => {
    await seedOff();
    expect(await deleteGallery(M, GID)).toBe("deleted");
    expect(await keys()).toEqual([]);
  });

  it("deleteGallery with versioning off resumes under a small budget", async () => {
    await seedOff();
    let out = await deleteGallery(M, GID, { r2CallsMax: 1 });
    for (let i = 0; out === "continue" && i < 10; i++)
      out = await deleteGallery(M, GID, { r2CallsMax: 1 });
    expect(out).toBe("deleted");
    expect(await keys()).toEqual([]);
  });

  it("an album that never had a version >= 2 costs the same D1 and R2 calls as before", async () => {
    await db.update(schema.galleries).set({ versioning: false });
    for (const id of ["A", "B"]) await seedVersioned(GID, id, [{ n: 1 }]);
    const del = vi.spyOn(env.CACHE, "delete");
    const prep = vi.spyOn(env.DB, "prepare");
    const batch = vi.spyOn(env.DB, "batch");
    expect(await deleteGallery(M, GID)).toBe("deleted");
    expect(del).toHaveBeenCalledTimes(1);
    // pinned on main: 5 statements outside the batches, 3 batches
    expect({ prepare: prep.mock.calls.length, batch: batch.mock.calls.length })
      .toMatchInlineSnapshot(`
        {
          "batch": 2,
          "prepare": 19,
        }
      `);
  });

  const pending = async () =>
    (await db.select().from(schema.settings)).find(
      (r) => r.key === "r2_pending_deletes",
    );
  const bulk = async (n: number, opts: { missing?: boolean } = {}) => {
    const rows: D1PreparedStatement[] = [];
    for (let i = 0; i < n; i++) {
      rows.push(
        env.DB.prepare(
          "INSERT INTO photos (id, gallery_id, base_name, sort, drive_highres_id, missing_since) VALUES (?1, ?2, ?1, ?3, 'h', ?4)",
        ).bind(`P${i}`, GID, i, opts.missing ? T : null),
      );
      for (const v of [2, 3])
        rows.push(
          env.DB.prepare(
            "INSERT INTO photo_versions (photo_id, gallery_id, version, drive_highres_id) VALUES (?1, ?2, ?3, 'h')",
          ).bind(`P${i}`, GID, v),
        );
    }
    for (let i = 0; i < rows.length; i += 500)
      await env.DB.batch(rows.slice(i, i + 500));
    const puts: Promise<unknown>[] = [];
    for (let i = 0; i < n; i++)
      for (const v of ["", "/v2", "/v3"])
        puts.push(env.CACHE.put(`P${i}${v}/thumb`, "x"));
    await Promise.all(puts);
  };

  it("(a) switching OFF only flips the flag: no queue, and a photo removed afterwards by sync leaves no v>=2 key", async () => {
    await sync(["A.jpg", "A_v2.jpg", "B.jpg"], T0);
    const a = (await db.select().from(schema.photos)).find(
      (p) => p.baseName === "A",
    )!;
    await put(a.id, "", "/v2");
    const res = await galleryAction(
      new Request(`http://localhost/admin/g/${GID}`, {
        method: "POST",
        body: new URLSearchParams({ intent: "versioning", versioning: "0" }),
      }),
      M,
      GID,
    );
    expect(res).toMatchObject({ ok: true });
    expect(await pending()).toBeUndefined();
    // the version rows are kept: they are the source of truth for what R2 holds
    expect(
      (await db.select().from(schema.photoVersions)).filter(
        (v) => v.version >= 2,
      ),
    ).toHaveLength(1);
    await sync(["B.jpg"], after(10)); // photo A removed with versioning off
    await sync(["B.jpg"], after(10 + 90));
    expect(await keys()).toEqual([]);
  });

  it("(b) legacy album already OFF with v2 rows: a removal reads them before the cascade", async () => {
    await db.update(schema.galleries).set({ versioning: false });
    await sync(["A.jpg", "B.jpg"], T0);
    const a = (await db.select().from(schema.photos)).find(
      (p) => p.baseName === "A",
    )!;
    await db.insert(schema.photoVersions).values({
      photoId: a.id,
      galleryId: GID,
      version: 2,
      driveHighresId: "H2",
      driveVersions: "{}",
    });
    await put(a.id, "", "/v2");
    await sync(["B.jpg"], after(10));
    await sync(["B.jpg"], after(100));
    expect(await keys()).toEqual([]);
  });

  it("(b2) a sync with no removal costs the same D1 calls with or without v2 rows (the extra read only happens on removal)", async () => {
    await db.update(schema.galleries).set({ versioning: false });
    await sync(["A.jpg", "B.jpg"], T0);
    const prep = vi.spyOn(env.DB, "prepare");
    await sync(["A.jpg", "B.jpg"], after(5));
    const n = prep.mock.calls.length;
    const [a] = await db.select().from(schema.photos);
    await db.insert(schema.photoVersions).values({
      photoId: a!.id,
      galleryId: GID,
      version: 2,
      driveHighresId: "H2",
      driveVersions: "{}",
    });
    prep.mockClear();
    await sync(["A.jpg", "B.jpg"], after(6));
    expect(prep.mock.calls.length).toBe(n);
  });

  it("(c) a big album (1001 photos with v2, v3) removed by sync, then another deleted: no key is lost or silently truncated", async () => {
    await db.update(schema.galleries).set({ versioning: false });
    await bulk(1001, { missing: true });
    expect((await keys()).length).toBe(3003);
    await sync(["Z.jpg"], T0); // every old photo is past its grace
    expect(await db.select().from(schema.photos)).toHaveLength(1);
    expect((await keys()).filter((k) => k.startsWith("P"))).toEqual([]);
    expect(await pending()).toBeUndefined();
  }, 120_000);

  it("(c2) the same big album under gallery delete loses no key either", async () => {
    await db.update(schema.galleries).set({ versioning: false });
    await bulk(1001);
    expect(await deleteGallery(M, GID)).toBe("deleted");
    expect(await keys()).toEqual([]);
  }, 120_000);

  it("(d) a failing flush keeps every removed key pending; the next sync finishes them", async () => {
    await sync(["A.jpg", "A_v2.jpg", "B.jpg"], T0);
    const a = (await db.select().from(schema.photos)).find(
      (p) => p.baseName === "A",
    )!;
    await put(a.id, "", "/v2");
    await db.update(schema.galleries).set({ versioning: false });
    await sync(["B.jpg"], after(10));
    const real = env.CACHE.delete.bind(env.CACHE);
    const del = vi
      .spyOn(env.CACHE, "delete")
      .mockRejectedValueOnce(new Error("r2 down"));
    await sync(["B.jpg"], after(100)); // removal; the flush fails in flight
    expect(await keys()).toHaveLength(6);
    expect(JSON.parse((await pending())!.value)).toEqual(
      expect.arrayContaining([a.id, `${a.id}/v2`]),
    );
    del.mockImplementation(real);
    await sync(["B.jpg"], after(110));
    expect(await keys()).toEqual([]);
    expect(await pending()).toBeUndefined();
  });
});
