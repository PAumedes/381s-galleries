import type { GalleryMode, GalleryStatus } from "../../constants";
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../../../db";
import {
  CLIENT_FILTER_NONE,
  groupIssues,
  normalizeSearch,
} from "../../admin-gallery";
import type { Filter } from "../../admin-gallery";
import { listCoverIdSql } from "../cover";
import { isExpired } from "../time";

const FILTER_STATUS: Record<Filter, "published" | "draft" | "archived" | null> =
  {
    todas: null,
    publicadas: "published",
    borradores: "draft",
    archivadas: "archived",
  };

/** A gallery whose deletion is in progress (tombstoned, row not gone yet): stays listed so it can be continued. */
const isDeletingSql = sql<boolean>`EXISTS (SELECT 1 FROM ignored_folders i WHERE i.drive_folder_id = ${schema.galleries.driveFolderId})`;

export interface GalleryListRow {
  id: string;
  title: string;
  slug: string;
  clientName: string | null;
  /** Client folder (T6.40c): its public slug builds the canonical address. */
  client: { id: string; name: string; slug: string } | null;
  eventDate: string | null;
  status: GalleryStatus;
  /** Prueba (watermarked, no downloads) or Entrega. */
  mode: GalleryMode;
  expiresAt: string | null;
  expired: boolean;
  /** Chosen cover when visible, else the first visible photo, else null. */
  coverPhotoId: string | null;
  photoCount: number;
  views: number;
  /** Per-photo download rows only (bulk header rows are excluded). */
  downloads: number;
  issueCount: number;
  /** Deletion started but not finished: the list offers "Continuar eliminación". */
  deleting: boolean;
}

/** `?cliente=`: "" = every album, "none" = no client, else one client id. */
function clientFilterSql(v: string): SQL | undefined {
  if (!v) return undefined;
  return v === CLIENT_FILTER_NONE
    ? isNull(schema.galleries.clientId)
    : eq(schema.galleries.clientId, v);
}

export async function listGalleries(
  env: Env,
  filter: Filter,
  q = "",
  clientFilter = "",
): Promise<GalleryListRow[]> {
  const g = schema.galleries;
  const status = FILTER_STATUS[filter];
  const rows = await getDb(env)
    .select({
      id: g.id,
      title: g.title,
      slug: g.slug,
      clientName: g.clientName,
      clientId: g.clientId,
      clientRowName: schema.clients.name,
      clientSlug: schema.clients.slug,
      eventDate: g.eventDate,
      status: g.status,
      mode: g.mode,
      expiresAt: g.expiresAt,
      syncIssuesJson: g.syncIssuesJson,
      coverPhotoId: listCoverIdSql(),
      photoCount: sql<number>`(SELECT count(*) FROM photos p WHERE p.gallery_id = galleries.id AND p.missing_since IS NULL)`,
      deleting: sql<number>`${isDeletingSql}`,
      views: sql<number>`(SELECT count(*) FROM gallery_views v WHERE v.gallery_id = galleries.id)`,
      downloads: sql<number>`(SELECT count(*) FROM downloads d WHERE d.gallery_id = galleries.id AND d.photo_id IS NOT NULL)`,
    })
    .from(g)
    .leftJoin(schema.clients, eq(g.clientId, schema.clients.id))
    .where(
      and(
        status ? eq(g.status, status) : undefined,
        clientFilterSql(clientFilter),
      ),
    )
    .orderBy(
      sql`${g.status} = 'archived'`,
      sql`${g.createdAt} DESC`,
      asc(g.title),
      asc(g.id),
    );
  const now = Date.now();
  // Search on the loaded rows (a studio has well under 1000 galleries):
  // accent/case-insensitive substring over title, slug and client name.
  const needle = normalizeSearch(q);
  const matched = needle
    ? rows.filter((r) =>
        [r.title, r.slug, r.clientName ?? ""].some((v) =>
          normalizeSearch(v).includes(needle),
        ),
      )
    : rows;
  return matched.map(
    ({ syncIssuesJson, clientId, clientRowName, clientSlug, ...r }) => ({
      ...r,
      client:
        clientId && clientRowName !== null && clientSlug !== null
          ? { id: clientId, name: clientRowName, slug: clientSlug }
          : null,
      deleting: !!r.deleting,
      expired: isExpired(r.expiresAt, now),
      issueCount: groupIssues(syncIssuesJson).total,
    }),
  );
}

/** Number of galleries per status (for the empty-state decision). */
export async function countGalleries(env: Env): Promise<number> {
  const [r] = await getDb(env)
    .select({ n: sql<number>`count(*)` })
    .from(schema.galleries);
  return r?.n ?? 0;
}
