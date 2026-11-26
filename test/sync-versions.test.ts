import { migrateDb } from "./support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { getDb, nowIso, schema } from "../app/db";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { meterD1 } from "../app/lib/server/d1-meter";
import { FOLDER_MIME } from "../app/lib/server/drive-types";
import type { MockEntry } from "../app/lib/server/fixtures";
import { runSync } from "../app/lib/server/sync";
import { ISSUE_KEYS } from "../app/lib/admin-gallery";

/**
 * T6.53b: sync parses versions (suffix primary, `v<N>/` round folder
 * fallback), writes photo_versions and delivery_rounds for albums with
 * galleries.versioning = 1, and leaves every other album untouched.
 */
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const T = "2026-01-01T00:00:00.000Z";
const ROOT = "root";
const T0 = new Date("2026-03-01T12:00:00Z");
const after = (min: number) => new Date(T0.getTime() + min * 60_000);

const folder = (id: string, name: string, parentId: string): MockEntry => ({
  id,
  name,
  mimeType: FOLDER_MIME,
  modifiedTime: T,
  parentId,
});
/** Folders: album `alb`; recipe folders hr/web; round folders r2/r3 with their own hr/web. */
const FOLDERS: MockEntry[] = [
  { ...folder(ROOT, "root", ""), parentId: null },
  folder("alb", "Alb", ROOT),
  folder("hr", "high-res", "alb"),
  folder("web", "web", "alb"),
  folder("r2", "v2", "alb"),
  folder("r2hr", "high-res", "r2"),
  folder("r2web", "web", "r2"),
  folder("r3", "v3", "alb"),
  folder("r3hr", "high-res", "r3"),
];
/** `[parent, name, extra]`: the file id is `<parent>/<name>`. */
type F = [string, string, Partial<MockEntry>?];
const drive = (files: F[], extra: MockEntry[] = []) =>
  createMockDrive({
    rootId: ROOT,
    entries: [
      ...FOLDERS,
      ...extra,
      ...files.map(([parent, name, over]): MockEntry => ({
        id: `${parent}/${name}`,
        name,
        mimeType: "image/jpeg",
        modifiedTime: T,
        parentId: parent,
        width: 2000,
        height: 1000,
        size: 1000,
        ...over,
      })),
    ],
  });
const sync = (files: F[], now: Date, extra: MockEntry[] = []) =>
  runSync(e, { drive: drive(files, extra), force: true, now, budget: 200 });

const GID = "g1";
async function addGallery(versioning: boolean) {
  await db.insert(schema.galleries).values({
    id: GID,
    driveFolderId: "alb",
    slug: "alb",
    title: "Alb",
    status: "published",
    versioning,
  });
}
const photos = () =>
  db.select().from(schema.photos).where(eq(schema.photos.galleryId, GID));
const versions = () =>
  db
    .select()
    .from(schema.photoVersions)
    .orderBy(
      asc(schema.photoVersions.photoId),
      asc(schema.photoVersions.version),
    );
const rounds = () =>
  db
    .select()
    .from(schema.deliveryRounds)
    .orderBy(asc(schema.deliveryRounds.number));
const roundNo = async (id: string | null) =>
  id === null ? null : (await rounds()).find((r) => r.id === id)?.number;
const summary = async () =>
  Promise.all(
    (await versions()).map(async (v) => ({
      v: v.version,
      hr: v.driveHighresId,
      round: await roundNo(v.roundId),
    })),
  );

beforeAll(migrateDb);
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.delete(schema.settings);
  await db
    .insert(schema.settings)
    .values({ key: "drive_root_id", value: ROOT });
});

describe("T6.53b sync: versioning = 0 (default) albums are untouched", () => {
  it("`IMG_1_v2` stays its own photo, no version or round rows, no conflict", async () => {
    await addGallery(false);
    await sync(
      [
        ["hr", "IMG_1.jpg"],
        ["hr", "IMG_1_v2.jpg"],
      ],
      T0,
    );
    expect((await photos()).map((p) => p.baseName).sort()).toEqual([
      "IMG_1",
      "IMG_1_v2",
    ]);
    expect(await versions()).toEqual([]);
    expect(await rounds()).toEqual([]);
  });

  it("a `v2/` folder is still an unknown folder and its files are not photos", async () => {
    await addGallery(false);
    await sync(
      [
        ["hr", "IMG_1.jpg"],
        ["r2hr", "IMG_1.jpg"],
      ],
      T0,
    );
    const [g] = await db.select().from(schema.galleries);
    expect(g.syncIssuesJson).toContain('"unknown_folder"');
    expect((await photos()).length).toBe(1);
    expect(await versions()).toEqual([]);
  });
});

describe("T6.53b sync: suffix versions", () => {
  beforeEach(() => addGallery(true));

  it("a first delivery is v1 with no round; photos keeps its stable id", async () => {
    await sync(
      [
        ["hr", "IMG_1.jpg"],
        ["web", "IMG_1.jpg"],
      ],
      T0,
    );
    const [p] = await photos();
    expect(await versions()).toMatchObject([
      {
        photoId: p.id,
        galleryId: GID,
        version: 1,
        roundId: null,
        driveHighresId: "hr/IMG_1.jpg",
        driveWebId: "web/IMG_1.jpg",
        driveTiffId: null,
        firstSeenAt: nowIso(T0),
      },
    ]);
    expect(await rounds()).toEqual([]);
  });

  it("a resend creates v2 in round 2; photos mirrors v2; v1 stays", async () => {
    await sync([["hr", "IMG_1.jpg"]], T0);
    const [p0] = await photos();
    const r = await sync(
      [
        ["hr", "IMG_1.jpg"],
        ["hr", "IMG_1_v2.jpg"],
        ["web", "IMG_1_v2.jpg"],
      ],
      after(20),
    );
    const [p] = await photos();
    expect(p.id).toBe(p0.id);
    expect(p.driveHighresId).toBe("hr/IMG_1_v2.jpg");
    expect(p.driveWebId).toBe("web/IMG_1_v2.jpg");
    expect(r.photos).toEqual({ added: 0, updated: 1, removed: 0 });
    expect(await summary()).toEqual([
      { v: 1, hr: "hr/IMG_1.jpg", round: null },
      { v: 2, hr: "hr/IMG_1_v2.jpg", round: 2 },
    ]);
    expect(await rounds()).toMatchObject([
      {
        galleryId: GID,
        number: 2,
        name: null,
        startedAt: nowIso(after(20)),
      },
    ]);
  });

  it("files first seen within 60 minutes of the round's last arrival join it; later ones start a new round", async () => {
    const base: F[] = [
      ["hr", "A.jpg"],
      ["hr", "B.jpg"],
      ["hr", "C.jpg"],
    ];
    await sync(base, T0);
    const a2: F = ["hr", "A_v2.jpg"];
    const b2: F = ["hr", "B_v2.jpg"];
    const c2: F = ["hr", "C_v2.jpg"];
    await sync([...base, a2], after(15));
    await sync([...base, a2, b2], after(60)); // 45 min after A_v2
    await sync([...base, a2, b2, c2], after(60 + 61)); // 61 min after B_v2
    const rs = await rounds();
    expect(rs.map((r) => r.number)).toEqual([2, 3]);
    const byName = Object.fromEntries(
      await Promise.all(
        (await versions())
          .filter((v) => v.version === 2)
          .map(async (v) => [v.driveHighresId, await roundNo(v.roundId)]),
      ),
    );
    expect(byName).toEqual({
      "hr/A_v2.jpg": 2,
      "hr/B_v2.jpg": 2,
      "hr/C_v2.jpg": 3,
    });
  });

  it("an unchanged re-sync adds nothing (no new round, rows identical)", async () => {
    const files: F[] = [
      ["hr", "A.jpg"],
      ["hr", "A_v2.jpg"],
    ];
    await sync(files, T0);
    const before = [await versions(), await rounds()];
    const r = await sync(files, after(500));
    expect(r.photos).toEqual({ added: 0, updated: 0, removed: 0 });
    expect([await versions(), await rounds()]).toEqual(before);
  });

  it("a replaced file of an existing version updates that row, keeps its round", async () => {
    await sync(
      [
        ["hr", "A.jpg"],
        ["hr", "A_v2.jpg"],
      ],
      T0,
    );
    const roundBefore = (await versions())[1].roundId;
    await sync(
      [
        ["hr", "A.jpg"],
        [
          "hr",
          "A_v2.jpg",
          { id: "new-id", modifiedTime: "2026-02-01T00:00:00.000Z" },
        ],
      ],
      after(600),
    );
    const v2 = (await versions())[1];
    expect(v2.driveHighresId).toBe("new-id");
    expect(v2.roundId).toBe(roundBefore);
    expect((await photos())[0].driveHighresId).toBe("new-id");
    expect(await rounds()).toHaveLength(1);
  });

  it("v3 after v2: latest is v3, one photo, versions 1..3", async () => {
    await sync(
      [
        ["hr", "A.jpg"],
        ["hr", "A_v2.jpg"],
      ],
      T0,
    );
    await sync(
      [
        ["hr", "A.jpg"],
        ["hr", "A_v2.jpg"],
        ["hr", "A_v3.jpg"],
      ],
      after(600),
    );
    expect(await photos()).toHaveLength(1);
    expect((await photos())[0].driveHighresId).toBe("hr/A_v3.jpg");
    expect((await summary()).map((s) => [s.v, s.round])).toEqual([
      [1, null],
      [2, 2],
      [3, 3],
    ]);
  });

  it("a version that disappears from Drive is removed and photos falls back to the previous one", async () => {
    await sync(
      [
        ["hr", "A.jpg"],
        ["hr", "A_v2.jpg"],
      ],
      T0,
    );
    await sync([["hr", "A.jpg"]], after(30));
    expect((await versions()).map((v) => v.version)).toEqual([1]);
    expect((await photos())[0].driveHighresId).toBe("hr/A.jpg");
  });

  it("removing a photo after the grace period deletes its versions (FK cascade)", async () => {
    await sync(
      [
        ["hr", "A.jpg"],
        ["hr", "A_v2.jpg"],
        ["hr", "B.jpg"],
      ],
      T0,
    );
    await sync([["hr", "B.jpg"]], after(10)); // marks A missing: a version vanished, photo marked
    await sync([["hr", "B.jpg"]], after(10 + 90));
    expect((await photos()).map((p) => p.baseName)).toEqual(["B"]);
    expect((await versions()).map((v) => v.driveHighresId)).toEqual([
      "hr/B.jpg",
    ]);
  });
});

describe("T6.53b sync: v1 mirror (decision T6.53a: sync re-derives, no trigger)", () => {
  it("v1 mirror stays equal to photos after a sync that changes the variant columns (versioning=1 album)", async () => {
    await addGallery(true);
    await sync([["hr", "A.jpg", { size: 5, width: 9 }]], T0);
    await sync(
      [
        [
          "hr",
          "A.jpg",
          {
            id: "hrA2",
            size: 7,
            width: 11,
            modifiedTime: "2026-02-01T00:00:00.000Z",
          },
        ],
        ["web", "A.jpg"],
      ],
      after(30),
    );
    const [p] = await photos();
    const [v] = await versions();
    expect(v).toMatchObject({
      version: 1,
      driveHighresId: p.driveHighresId,
      driveWebId: p.driveWebId,
      driveIgId: p.driveIgId,
      driveThumbId: p.driveThumbId,
      driveWmId: p.driveWmId,
      driveThumbWmId: p.driveThumbWmId,
      highresBytes: p.highresBytes,
      driveVersions: p.variantVersions,
      width: p.width,
      height: p.height,
    });
    expect(v.driveHighresId).toBe("hrA2");
    expect(v.highresBytes).toBe(7);
  });

  it("an album synced with versioning=0 and flipped on gets its rows re-derived (stale or missing v1 included)", async () => {
    await addGallery(false);
    await sync([["hr", "A.jpg"]], T0);
    expect(await versions()).toEqual([]);
    await db.update(schema.galleries).set({ versioning: true });
    // a stale backfilled-looking row that no longer matches photos
    const [p] = await photos();
    await db.insert(schema.photoVersions).values({
      photoId: p.id,
      galleryId: GID,
      version: 1,
      driveHighresId: "stale",
    });
    await sync([["hr", "A.jpg"]], after(30));
    expect((await versions()).map((v) => v.driveHighresId)).toEqual([
      "hr/A.jpg",
    ]);
  });
});

describe("T6.53b sync: round folders `v<N>/` (fallback)", () => {
  beforeEach(() => addGallery(true));

  it("v2/ holds the same recipe layout; every file there is v2 of the same photo, in round 2", async () => {
    await sync([["hr", "A.jpg"]], T0);
    await sync(
      [
        ["hr", "A.jpg"],
        ["r2hr", "A.jpg"],
        ["r2web", "A.jpg"],
      ],
      after(30),
    );
    const [p] = await photos();
    expect(p.driveHighresId).toBe("r2hr/A.jpg");
    expect(p.driveWebId).toBe("r2web/A.jpg");
    expect(await photos()).toHaveLength(1);
    expect(await summary()).toEqual([
      { v: 1, hr: "hr/A.jpg", round: null },
      { v: 2, hr: "r2hr/A.jpg", round: 2 },
    ]);
  });

  it("a folder round is exact: files arriving in v2/ hours apart are still round 2; v3/ is round 3", async () => {
    const base: F[] = [
      ["hr", "A.jpg"],
      ["hr", "B.jpg"],
    ];
    await sync(base, T0);
    await sync([...base, ["r2hr", "A.jpg"]], after(30));
    await sync(
      [...base, ["r2hr", "A.jpg"], ["r2hr", "B.jpg"]],
      after(30 + 600),
    );
    await sync(
      [...base, ["r2hr", "A.jpg"], ["r2hr", "B.jpg"], ["r3hr", "A.jpg"]],
      after(30 + 600 + 5),
    );
    expect((await summary()).map((s) => [s.hr, s.round]).sort()).toEqual(
      [
        ["hr/A.jpg", null],
        ["r2hr/A.jpg", 2],
        ["r3hr/A.jpg", 3],
        ["hr/B.jpg", null],
        ["r2hr/B.jpg", 2],
      ].sort(),
    );
    expect(await rounds()).toHaveLength(2);
  });

  it("stray files and unknown folders inside a round folder are issues; the round folder itself is not", async () => {
    await sync(
      [
        ["hr", "A.jpg"],
        ["r2", "notes.txt", { mimeType: "text/plain" }],
      ],
      T0,
      [folder("r2x", "Misc", "r2")],
    );
    const [g] = await db.select().from(schema.galleries);
    const issues = JSON.parse(g.syncIssuesJson ?? "[]") as {
      type: string;
      name: string;
    }[];
    expect(issues).toContainEqual({
      type: "stray_file",
      set: null,
      name: "notes.txt",
    });
    expect(issues).toContainEqual({
      type: "unknown_folder",
      set: null,
      name: "Misc",
    });
    expect(issues.some((i) => i.name === "v2")).toBe(false);
  });

  it("set subfolders inside a round recipe folder are read (deepest level)", async () => {
    await sync(
      [
        ["hr", "A.jpg"],
        ["r2set", "A.jpg"],
      ],
      T0,
      [folder("r2set", "Highlights", "r2hr")],
    );
    expect((await summary()).map((s) => s.v)).toEqual([1, 2]);
  });
});

describe("T6.53b sync: conflicts go to the admin mismatch list", () => {
  beforeEach(() => addGallery(true));

  it("suffix and v2/ folder for the same file: suffix wins, version_conflict listed, label exists", async () => {
    await sync(
      [
        ["hr", "A.jpg"],
        ["hr", "A_v2.jpg"],
        ["r2hr", "A.jpg"],
      ],
      T0,
    );
    expect((await photos())[0].driveHighresId).toBe("hr/A_v2.jpg");
    const [g] = await db.select().from(schema.galleries);
    expect(JSON.parse(g.syncIssuesJson ?? "[]")).toContainEqual({
      type: "version_conflict",
      set: "Highlights",
      name: "A_v2",
    });
    expect(ISSUE_KEYS.version_conflict).toBe("admin.issue.version_conflict");
  });
});

describe("T6.53b sync: D1 budgets", () => {
  it("an unchanged re-sync of a versioned album costs exactly 2 extra reads; versioning=0 costs none", async () => {
    const files: F[] = [
      ["hr", "A.jpg"],
      ["hr", "A_v2.jpg"],
    ];
    const resyncCost = async (versioning: boolean) => {
      await db.delete(schema.galleries);
      await db.delete(schema.settings);
      await db
        .insert(schema.settings)
        .values({ key: "drive_root_id", value: ROOT });
      await addGallery(versioning);
      await sync(files, T0);
      const m = meterD1(e);
      await runSync(m.env, {
        drive: drive(files),
        force: true,
        now: after(1),
        budget: 200,
      });
      return m.used();
    };
    const off = await resyncCost(false);
    const on = await resyncCost(true);
    expect(on - off).toBe(2);
  });

  it("many versioned photos stay within 100 bound params per statement and 100 statements per batch", async () => {
    await addGallery(true);
    const max = { params: 0, batch: 0 };
    const track = (st: object): object =>
      new Proxy(st, {
        get(s, k) {
          const v = (s as never)[k];
          if (k === "bind")
            return (...a: unknown[]) => {
              max.params = Math.max(max.params, a.length);
              return track((v as (...x: unknown[]) => object).apply(s, a));
            };
          return typeof v === "function" ? v.bind(s) : v;
        },
      });
    const DB = new Proxy(env.DB, {
      get(t, k) {
        const v = (t as never)[k];
        if (k === "prepare") return (sql: string) => track(t.prepare(sql));
        if (k === "batch")
          return (stmts: unknown[]) => {
            max.batch = Math.max(max.batch, stmts.length);
            return (v as (...x: unknown[]) => unknown).call(t, stmts);
          };
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const ec = { ...e, DB } as Env;
    const n = Array.from({ length: 120 }, (_, i) => i);
    const v1 = n.map((i): F => ["hr", `IMG_${i}.jpg`]);
    const v2 = n.map((i): F => ["hr", `IMG_${i}_v2.jpg`]);
    await runSync(ec, {
      drive: drive([...v1, ...v2]),
      force: true,
      now: T0,
      budget: 200,
    });
    await runSync(ec, {
      drive: drive([
        ...v1,
        ...v2.map(([p, nm]): F => [
          p,
          nm,
          { id: `x${nm}`, modifiedTime: "2026-02-01T00:00:00.000Z" },
        ]),
      ]),
      force: true,
      now: after(600),
      budget: 200,
    });
    expect((await versions()).length).toBe(240);
    expect(max.params).toBeLessThanOrEqual(100);
    expect(max.batch).toBeLessThanOrEqual(100);
  }, 60_000);
});
