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
import { getDb, schema } from "../../app/db";
import { galleryAction } from "../../app/lib/server/admin-galleries";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../../app/lib/server/drive-types";
import type { MockEntry } from "../../app/lib/server/fixtures";
// Obsolete mechanism (toggle-time queue removed in the T6.55 rework): a no-op stub keeps the skipped tests compiling.
const queueVersionCaches = async (_env: Env, _galleryId: string) => {};
import { runSync } from "../../app/lib/server/sync";
import { clearCache } from "../support/cache";
import { migrateDb, resetTables } from "../support/d1";
import { seedVersioned } from "../support/versions";

const M = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const GID = "g1";
const T = "2026-01-01T00:00:00.000Z";
const T0 = new Date("2026-03-01T12:00:00Z");
const after = (min: number) => new Date(T0.getTime() + min * 60_000);
const folder = (id: string, name: string, parentId: string | null) =>
  ({ id, name, mimeType: FOLDER_MIME, modifiedTime: T, parentId }) as MockEntry;
const sync = (names: string[], now: Date) =>
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
    now,
    budget: 200,
  });
const keys = async () =>
  (await env.CACHE.list()).objects.map((o) => o.key).sort();
const put = (id: string, ...p: string[]) =>
  Promise.all(
    p.flatMap((x) =>
      ["thumb", "view-sm", "view-lg"].map((v) =>
        env.CACHE.put(`${id}${x}/${v}`, "x"),
      ),
    ),
  );
const pendingSetting = async () =>
  JSON.parse(
    (
      await db
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.key, "r2_pending_deletes"))
    )[0]?.value ?? "[]",
  ) as string[];
const off = (e: Env) =>
  galleryAction(
    new Request(`http://localhost/admin/g/${GID}`, {
      method: "POST",
      body: new URLSearchParams({ intent: "versioning", versioning: "0" }),
    }),
    e,
    GID,
  );

beforeAll(migrateDb);
beforeEach(async () => {
  await resetTables(
    "settings",
    "photos",
    "galleries",
    "photo_versions",
    "delivery_rounds",
    "ignored_folders",
  );
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

describe("T6.55 adversarial", () => {
  // Obsolete: toggle-time queue removed in T6.55 rework; equivalent behaviour covered by "(c) a big album ... no key is lost or silently truncated" and "(c2)" in test/photo-versions-r2.test.ts
  it.skip("queueVersionCaches silently drops keys past the 2000-entry cap (oldest first, other galleries' pending included)", async () => {
    await db
      .insert(schema.settings)
      .values({ key: "r2_pending_deletes", value: JSON.stringify(["OTHER"]) });
    const rows: D1PreparedStatement[] = [];
    for (let i = 0; i < 1001; i++) {
      rows.push(
        env.DB.prepare(
          "INSERT INTO photos (id, gallery_id, base_name, sort, drive_highres_id) VALUES (?1, ?2, ?1, ?3, 'h')",
        ).bind(`P${i}`, GID, i),
      );
      for (const n of [2, 3])
        rows.push(
          env.DB.prepare(
            "INSERT INTO photo_versions (photo_id, gallery_id, version, drive_highres_id) VALUES (?1, ?2, ?3, 'h')",
          ).bind(`P${i}`, GID, n),
        );
    }
    for (let i = 0; i < rows.length; i += 500)
      await env.DB.batch(rows.slice(i, i + 500));
    rows.length = 0;
    await queueVersionCaches(env, GID);
    const p = await pendingSetting();
    expect(rows.length).toBe(0);
    expect(p).toContain("OTHER");
    expect(p).toContain("P0/v2");
    expect(p).toHaveLength(2003);
  }, 120_000);

  // Obsolete: toggle-time queue removed in T6.55 rework; equivalent behaviour covered by "(d) a failing flush keeps every removed key pending" in test/photo-versions-r2.test.ts
  it.skip("a version switch queued while a flush is in flight is erased by the flush's final drop", async () => {
    await seedVersioned(GID, "A", [{ n: 1 }, { n: 2 }]);
    await put("A", "", "/v2");
    await db.update(schema.galleries).set({ versioning: false });
    await db
      .insert(schema.settings)
      .values({ key: "r2_pending_deletes", value: JSON.stringify(["ZZZ"]) });
    const real = env.CACHE.delete.bind(env.CACHE);
    let once = false;
    vi.spyOn(env.CACHE, "delete").mockImplementation(async (k) => {
      await real(k);
      if (!once) {
        once = true;
        await queueVersionCaches(env, GID); // admin toggles OFF meanwhile (no lock taken)
      }
    });
    await sync(["A.jpg"], T0);
    const stillQueued = (await pendingSetting()).includes("A/v2");
    const gone = !(await keys()).some((k) => k.startsWith("A/v2/"));
    expect(stillQueued || gone).toBe(true);
  });

  // Obsolete: toggle-time queue removed in T6.55 rework; equivalent behaviour covered by "(a) switching OFF only flips the flag ..." in test/photo-versions-r2.test.ts
  it.skip("if queueing fails after the flag flipped, a retry of the same switch is a no-op and the keys are never queued", async () => {
    await seedVersioned(GID, "A", [{ n: 1 }, { n: 2 }]);
    const bad = {
      ...M,
      DB: new Proxy(env.DB, {
        get(t, k) {
          if (k === "prepare")
            return (sql: string) => {
              if (/insert into "settings"/i.test(sql))
                throw new Error("d1 down");
              return t.prepare(sql);
            };
          const v = (t as never)[k];
          return typeof v === "function" ? v.bind(t) : v;
        },
      }),
    } as Env;
    await off(bad).catch(() => {});
    await off(M).catch(() => {});
    expect(await pendingSetting()).toContain("A/v2");
  });

  it("legacy album already OFF with v2 rows (switched off before the fix): removing the photo by sync strands its v2 keys", async () => {
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
});
