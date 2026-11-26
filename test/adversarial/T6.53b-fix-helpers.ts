import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach } from "vitest";
import { asc } from "drizzle-orm";
import { getDb, schema } from "../../app/db";
import { createMockDrive } from "../../app/lib/server/drive-mock";
import { FOLDER_MIME } from "../../app/lib/server/drive-types";
import type { MockEntry } from "../../app/lib/server/fixtures";
import { runSync } from "../../app/lib/server/sync";

export const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
export const db = getDb(env);
const T = "2026-01-01T00:00:00.000Z";
export const T0 = new Date("2026-03-01T12:00:00Z");
export const after = (min: number) => new Date(T0.getTime() + min * 60_000);
const fol = (id: string, name: string, parentId: string): MockEntry => ({
  id,
  name,
  mimeType: FOLDER_MIME,
  modifiedTime: T,
  parentId,
});
export const FOLDERS: MockEntry[] = [
  { ...fol("root", "root", ""), parentId: null },
  fol("alb", "Alb", "root"),
  fol("hr", "high-res", "alb"),
  fol("web", "web", "alb"),
  fol("r2", "v2", "alb"),
  fol("r2hr", "high-res", "r2"),
  fol("r3", "v3", "alb"),
  fol("r3hr", "high-res", "r3"),
];
export type F = [string, string];
export const file = ([parent, name]: F): MockEntry => ({
  id: `${parent}/${name}`,
  name,
  mimeType: "image/jpeg",
  modifiedTime: T,
  parentId: parent,
  width: 2000,
  height: 1000,
  size: 1000,
});
export const mk = (files: F[]) =>
  createMockDrive({
    rootId: "root",
    entries: [...FOLDERS, ...files.map(file)],
  });
export const sync = (files: F[], now: Date) =>
  runSync(e, { drive: mk(files), force: true, now, budget: 200 });
export const GID = "g1";
export async function addGallery(versioning: boolean) {
  await db.insert(schema.galleries).values({
    id: GID,
    driveFolderId: "alb",
    slug: "alb",
    title: "Alb",
    status: "published",
    versioning,
  });
}
export const versions = () =>
  db
    .select()
    .from(schema.photoVersions)
    .orderBy(
      asc(schema.photoVersions.photoId),
      asc(schema.photoVersions.version),
    );
export const rounds = () =>
  db
    .select()
    .from(schema.deliveryRounds)
    .orderBy(asc(schema.deliveryRounds.number));
export const numberOf = async (id: string | null) =>
  id === null ? null : (await rounds()).find((r) => r.id === id)?.number;
export function setup(versioning = true) {
  beforeAll(migrateDb);
  beforeEach(async () => {
    await db.delete(schema.galleries);
    await db.delete(schema.settings);
    await db
      .insert(schema.settings)
      .values({ key: "drive_root_id", value: "root" });
    await addGallery(versioning);
  });
}
