/**
 * The owner's overview of the approvals of a versioned album (T6.53f): how many
 * photos are approved at the version they show now, and how many are still to
 * review. A photo counts once however many visitors approved it, and only the
 * shown version counts (a new version re-opens it). Counts only: no visitor
 * ids, emails or Drive ids leave this module.
 */
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../../../db";

export interface ApprovalsSummary {
  approved: number;
  total: number;
  pending: number;
}

/**
 * ONE aggregate query (`VERSIONED_APPROVALS_D1_QUERIES`), for versioned albums
 * only. `shown` maps each visible photo to the version it shows.
 */
export async function approvalsSummary(
  env: Env,
  galleryId: string,
  shown: ReadonlyMap<string, number>,
): Promise<ApprovalsSummary> {
  const A = schema.photoApprovals;
  const rows = await getDb(env)
    .select({
      photoId: A.photoId,
      version: A.version,
      n: sql<number>`COUNT(*)`,
    })
    .from(A)
    .where(eq(A.galleryId, galleryId))
    .groupBy(A.photoId, A.version);
  const approved = new Set(
    rows
      .filter((r) => shown.get(r.photoId) === r.version)
      .map((r) => r.photoId),
  );
  return {
    approved: approved.size,
    total: shown.size,
    pending: shown.size - approved.size,
  };
}
