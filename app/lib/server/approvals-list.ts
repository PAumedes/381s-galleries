/**
 * The visitor's own approvals (T6.53f), folded into the favorites list reply.
 * An approval is one visitor's decision about one VERSION of one photo; the
 * list carries only the caller's `{ id, ver }` pairs (never a visitor id).
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "../../db";
import type { GalleryRow } from "./access";

/** Approvals one visitor may hold (like FAVORITES_MAX: bounds the list and the table). */
export const APPROVALS_MAX = 5000;

/**
 * `{ approvals: [{ id, ver }] }` for a versioned gallery (ONE query,
 * `VERSIONED_APPROVALS_D1_QUERIES`; none without a visitor), `{}` otherwise so
 * an unversioned album's reply is byte-identical to before.
 */
export async function approvalsField(
  env: Pick<Env, "DB">,
  g: Pick<GalleryRow, "id" | "versioning">,
  visitorId: string | null,
): Promise<{ approvals?: { id: string; ver: number }[] }> {
  if (!g.versioning) return {};
  if (!visitorId) return { approvals: [] };
  const A = schema.photoApprovals;
  const rows = await getDb(env as Env)
    .select({ id: A.photoId, ver: A.version })
    .from(A)
    .where(and(eq(A.galleryId, g.id), eq(A.visitorId, visitorId)))
    .orderBy(asc(A.approvedAt), asc(A.photoId), asc(A.version))
    .limit(APPROVALS_MAX);
  return { approvals: rows };
}
