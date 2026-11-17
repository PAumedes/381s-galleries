import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
export interface ActivityOpts {
  /** Visitor email (case-insensitive) or `"anon"` (anonymous or no visitor). */
  visitor?: string;
  variant?: "highres" | "web" | "ig";
  /** Keyset: rows strictly older than (createdAt, id). */
  before?: { createdAt: string; id: string };
  /** Hide per-photo rows that belong to a bulk header (they nest under it). */
  topLevel?: boolean;
  /** Only the per-photo rows of these bulk headers. */
  bulkIds?: readonly string[];
  limit?: number;
}

export function activityQuery(
  db: ReturnType<typeof getDb>,
  galleryId: string,
  opts: ActivityOpts = {},
) {
  const d = schema.downloads;
  const conds = [eq(d.galleryId, galleryId)];
  if (opts.visitor === "anon") {
    conds.push(
      sql`(${schema.visitors.email} IS NULL OR ${schema.visitors.email} LIKE '%@anon.invalid')`,
    );
  } else if (opts.visitor) {
    conds.push(sql`${schema.visitors.email} = ${opts.visitor} COLLATE NOCASE`);
  }
  if (opts.variant) conds.push(eq(d.variant, opts.variant));
  if (opts.before) {
    conds.push(
      sql`(${d.createdAt} < ${opts.before.createdAt} OR (${d.createdAt} = ${opts.before.createdAt} AND ${d.id} < ${opts.before.id}))`,
    );
  }
  if (opts.topLevel) {
    conds.push(
      sql`(${d.photoId} IS NULL OR ${d.bulkId} IS NULL OR ${d.bulkId} NOT IN (SELECT h.id FROM downloads h WHERE h.gallery_id = ${galleryId} AND h.photo_id IS NULL))`,
    );
  }
  if (opts.bulkIds) conds.push(inArray(d.bulkId, [...opts.bulkIds]));
  return db
    .select({
      id: d.id,
      photoId: d.photoId,
      visitorId: d.visitorId,
      variant: d.variant,
      kind: d.kind,
      bulkId: d.bulkId,
      bulkScope: d.bulkScope,
      country: d.country,
      createdAt: d.createdAt,
      email: sql<
        string | null
      >`CASE WHEN ${schema.visitors.email} LIKE '%@anon.invalid' THEN NULL ELSE ${schema.visitors.email} END`,
    })
    .from(d)
    .leftJoin(
      schema.visitors,
      and(
        eq(schema.visitors.id, d.visitorId),
        eq(schema.visitors.galleryId, d.galleryId),
      ),
    )
    .where(and(...conds))
    .orderBy(desc(d.createdAt), desc(d.id))
    .limit(opts.limit ?? -1);
}
