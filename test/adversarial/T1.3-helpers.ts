import { migrateDb } from "../support/d1";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../../app/db";
import { buildFixtures } from "../../app/lib/server/fixtures";
import type { DriveClient } from "../../app/lib/server/drive-types";

export const e = { ...env, DRIVE_MODE: "mock", ALLOW_DEV_ADMIN: "1" } as Env;
export const db = getDb(env);
export const ROOT = () => buildFixtures().rootId;

export function setup() {
  beforeAll(async () => {
    await migrateDb();
  });
  beforeEach(async () => {
    await db.delete(schema.galleries);
    await db.delete(schema.settings);
    const l = await env.CACHE.list();
    for (const o of l.objects) await env.CACHE.delete(o.key);
    await db
      .insert(schema.settings)
      .values({ key: "drive_root_id", value: ROOT() });
  });
}

export async function child(d: DriveClient, parent: string, name: string) {
  const k = (await d.listChildren(parent)).find((x) => x.name === name);
  if (!k) throw new Error(`missing ${name}`);
  return k;
}
export async function walk(d: DriveClient, ...path: string[]) {
  let id = ROOT();
  for (const p of path) id = (await child(d, id, p)).id;
  return id;
}
export const galleryBy = async (slug: string) =>
  (
    await db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.slug, slug))
  )[0];
export const photosOf = (galleryId: string) =>
  db.select().from(schema.photos).where(eq(schema.photos.galleryId, galleryId));
