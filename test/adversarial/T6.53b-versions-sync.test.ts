import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "../../app/db";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { meterD1 } from "../../app/lib/server/d1-meter";
import { FOLDER_MIME } from "../../app/lib/server/drive-types";
import type { MockEntry } from "../../app/lib/server/fixtures";
import { runSync } from "../../app/lib/server/sync";

const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
const db = getDb(env);
const T = "2026-01-01T00:00:00.000Z";
const ROOT = "root";
const T0 = new Date("2026-03-01T12:00:00Z");
const after = (min: number) => new Date(T0.getTime() + min * 60_000);
const folder = (id: string, name: string, parentId: string): MockEntry => ({
  id, name, mimeType: FOLDER_MIME, modifiedTime: T, parentId,
});
const FOLDERS: MockEntry[] = [
  { ...folder(ROOT, "root", ""), parentId: null },
  folder("alb", "Alb", ROOT),
  folder("hr", "high-res", "alb"),
  folder("web", "web", "alb"),
  folder("r1", "v1", "alb"),
  folder("r1hr", "high-res", "r1"),
  folder("r3", "v3", "alb"),
  folder("r3hr", "high-res", "r3"),
];
type F = [string, string, Partial<MockEntry>?];
const drive = (files: F[]) =>
  createMockDrive({
    rootId: ROOT,
    entries: [
      ...FOLDERS,
      ...files.map(([parent, name, over]): MockEntry => ({
        id: `${parent}/${name}`, name, mimeType: "image/jpeg", modifiedTime: T,
        parentId: parent, width: 2000, height: 1000, size: 1000, ...over,
      })),
    ],
  });
const sync = (files: F[], now: Date) =>
  runSync(e, { drive: drive(files), force: true, now, budget: 200 });
const GID = "g1";
async function addGallery(versioning: boolean) {
  await db.insert(schema.galleries).values({
    id: GID, driveFolderId: "alb", slug: "alb", title: "Alb", status: "published", versioning,
  });
}
const photos = () => db.select().from(schema.photos).where(eq(schema.photos.galleryId, GID));
const versions = () => db.select().from(schema.photoVersions).orderBy(asc(schema.photoVersions.photoId), asc(schema.photoVersions.version));
const rounds = () => db.select().from(schema.deliveryRounds).orderBy(asc(schema.deliveryRounds.number));
beforeAll(migrateDb);
beforeEach(async () => {
  await db.delete(schema.galleries);
  await db.delete(schema.settings);
  await db.insert(schema.settings).values({ key: "drive_root_id", value: ROOT });
  await addGallery(true);
});


const numberOf = async (id: string | null) =>
  id === null ? null : (await rounds()).find((r) => r.id === id)?.number;

describe("T6.53b adversarial", () => {
  it("a suffix version delivered while a v<N>/ round exists must not be absorbed into the folder's round", async () => {
    await sync([["hr", "A.jpg"], ["hr", "B.jpg"]], T0);
    await sync(
      [["hr", "A.jpg"], ["hr", "B.jpg"], ["r3hr", "A.jpg"], ["hr", "B_v5.jpg"]],
      after(5),
    );
    const byV = new Map<string, number | null | undefined>();
    for (const v of await versions())
      byV.set(`${v.version}`, await numberOf(v.roundId));
    expect(byV.get("3")).toBe(3);
    // B_v5 arrived by suffix, not from the v3/ folder: round 3 means "exactly the v3/ folder's files"
    expect(byV.get("5")).not.toBe(3);
  });

  it("a version that vanishes for one sync (transient Drive/Capture One re-export) keeps its round when it returns", async () => {
    await sync([["hr", "A.jpg"], ["hr", "A_v2.jpg"]], T0);
    expect(await numberOf((await versions()).find((v) => v.version === 2)!.roundId)).toBe(2);
    await sync([["hr", "A.jpg"]], after(10));
    await sync([["hr", "A.jpg"], ["hr", "A_v2.jpg"]], after(240));
    const v2 = (await versions()).find((v) => v.version === 2)!;
    expect(await numberOf(v2.roundId)).toBe(2);
  });

  it("an orphan vN file names its version in the missing_highres issue", async () => {
    await sync([["hr", "IMG.jpg"], ["web", "IMG_v3.jpg"]], T0);
    const [g] = await db.select().from(schema.galleries);
    const issue = JSON.parse(g.syncIssuesJson!).find((i: { type: string }) => i.type === "missing_highres");
    expect(issue.name).toMatch(/v3/i);
  });
});
