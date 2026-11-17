import { desc, eq, sql } from "drizzle-orm";
import { schema, type getDb } from "../../db";

/**
 * Download activity of one gallery (Phase 4 admin stats / CSV).
 *
 * - Bulk header rows: `kind = 'bulk'`, `photo_id` NULL (one per "download all/set").
 * - Per-photo rows: `photo_id` NOT NULL (`kind` single, or bulk when the file came
 *   from a bulk run); retries of one token log once.
 * - `email` is null for anonymous visitors (`...@anon.invalid`) and for rows
 *   without a visitor, so they never reach stats or exports.
 */
export function activityQuery(db: ReturnType<typeof getDb>, galleryId: string) {
  return db
    .select({
      id: schema.downloads.id,
      photoId: schema.downloads.photoId,
      variant: schema.downloads.variant,
      kind: schema.downloads.kind,
      country: schema.downloads.country,
      createdAt: schema.downloads.createdAt,
      email: sql<
        string | null
      >`CASE WHEN ${schema.visitors.email} LIKE '%@anon.invalid' THEN NULL ELSE ${schema.visitors.email} END`,
    })
    .from(schema.downloads)
    .leftJoin(
      schema.visitors,
      eq(schema.visitors.id, schema.downloads.visitorId),
    )
    .where(eq(schema.downloads.galleryId, galleryId))
    .orderBy(desc(schema.downloads.createdAt));
}
