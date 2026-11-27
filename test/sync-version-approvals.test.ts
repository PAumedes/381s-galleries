import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "../app/db";
import { handleSetApproval } from "../app/lib/server/approvals";
import { createMockDrive } from "../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../app/lib/server/drive-types";
import { runSync } from "../app/lib/server/sync";
import { migrateDb } from "./support/d1";

// T6.53f: a sync that REPLACES the files of a version row clears its approvals
// (same batch); metadata-only changes keep them.
const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const T0 = new Date("2026-03-01T12:00:00Z");
let n = 0;
const at = () => new Date(T0.getTime() + ++n * 3600_000);
const folder = (
  id: string,
  name: string,
  parentId: string | null,
  m: string,
) => ({
  id,
  name,
  mimeType: FOLDER_MIME,
  modifiedTime: m,
  parentId,
});
const drive = (modified: string, o: { size?: number; width?: number } = {}) =>
  createMockDrive({
    rootId: "root",
    entries: [
      folder("root", "root", null, modified),
      folder("alb", "Alb", "root", modified),
      folder("hr", "high-res", "alb", modified),
      {
        id: "hr/IMG_1.jpg",
        name: "IMG_1.jpg",
        mimeType: "image/jpeg",
        modifiedTime: modified,
        parentId: "hr",
        width: o.width ?? 2000,
        height: 1000,
        size: o.size ?? 1000,
      },
    ],
  });
const sync = (d: ReturnType<typeof drive>) =>
  runSync(e, { drive: d, force: true, now: at(), budget: 200 });
const OLD = "2026-01-01T00:00:00.000Z";
const NEW = "2026-02-01T00:00:00.000Z";

beforeAll(migrateDb);
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.delete(schema.settings);
  await db
    .insert(schema.settings)
    .values({ key: "drive_root_id", value: "root" });
  await db.insert(schema.galleries).values({
    id: "g1",
    driveFolderId: "alb",
    slug: "alb",
    title: "Alb",
    status: "published",
    versioning: true,
    requireEmail: false,
  });
});

async function approveV1() {
  await sync(drive(OLD));
  const [p] = await db.select().from(schema.photos);
  const res = await handleSetApproval(
    new Request("https://x.test/api/g/alb/approvals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "1.1.1.1",
      },
      body: JSON.stringify({ photoId: p.id, version: 1, on: true }),
    }),
    "alb",
    e,
  );
  expect(res.status).toBe(200);
}
const approvals = () => db.select().from(schema.photoApprovals);

describe("T6.53f approvals vs sync updating a version row in place", () => {
  it("a replaced file (new modified time) clears that version's approvals", async () => {
    await approveV1();
    await sync(drive(NEW));
    expect(await approvals()).toEqual([]);
  });

  it("an unchanged re-sync keeps them", async () => {
    await approveV1();
    await sync(drive(OLD));
    expect(await approvals()).toHaveLength(1);
  });

  it("a metadata-only change (size, pixel size) keeps them", async () => {
    await approveV1();
    await sync(drive(OLD, { size: 5000, width: 3000 }));
    const [v] = await db.select().from(schema.photoVersions);
    expect(v.width).toBe(3000); // the row WAS updated in place
    expect(await approvals()).toHaveLength(1);
  });

  it("a round-only change keeps them", async () => {
    await approveV1();
    await db
      .insert(schema.deliveryRounds)
      .values({ id: "r9", galleryId: "g1", number: 9 });
    await db
      .update(schema.photoVersions)
      .set({ roundId: "r9" })
      .where(eq(schema.photoVersions.version, 1));
    await sync(drive(OLD));
    expect(await approvals()).toHaveLength(1);
  });

  it("a file that left Drive and came back unchanged keeps them", async () => {
    await approveV1();
    await db.update(schema.photoVersions).set({
      driveVersions: JSON.stringify({
        ...JSON.parse(
          (await db.select().from(schema.photoVersions))[0].driveVersions!,
        ),
        missingSince: "2026-03-01T00:00:00.000Z",
      }),
    });
    await sync(drive(OLD));
    expect(await approvals()).toHaveLength(1);
  });

  it("versioning off then on: the stale row rewritten by the next versioned sync clears them", async () => {
    await approveV1();
    await db.update(schema.galleries).set({ versioning: false });
    await sync(drive(NEW)); // versioning=0 writes no version rows
    expect(await approvals()).toHaveLength(1);
    await db.update(schema.galleries).set({ versioning: true });
    await sync(drive(NEW));
    expect(await approvals()).toEqual([]);
  });
});
