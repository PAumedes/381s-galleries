import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../db";

export async function loadGallery(env: Env, id: string) {
  const [g] = await getDb(env)
    .select({
      id: schema.galleries.id,
      title: schema.galleries.title,
      slug: schema.galleries.slug,
    })
    .from(schema.galleries)
    .where(eq(schema.galleries.id, id));
  return g ?? null;
}

export async function photoMap(env: Env, galleryId: string) {
  const ps = await getDb(env)
    .select({
      id: schema.photos.id,
      name: schema.photos.baseName,
      set: schema.photos.setName,
    })
    .from(schema.photos)
    .where(eq(schema.photos.galleryId, galleryId));
  return new Map(ps.map((p) => [p.id, p]));
}
