import { DOWNLOAD_SIZES, type DownloadSize } from "../../constants";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../../../db";
import { visitorDisplay, type VisitorDisplay } from "../../admin-activity";
import { activityQuery, visitorFields } from "../activity";
import { loadGallery, photoMap } from "./shared";

export const ACTIVITY_PAGE = 50;
const CHILD_CAP = 1000;
const VIEWS_CAP = 50;
const BREAKDOWN_CAP = 5;
/** Per-gallery summary: key -> `gallery_views` column (fixed list, never user input). */
const BREAKDOWN_COLUMNS = {
  countries: "country",
  devices: "device",
  browsers: "browser",
  referrers: "referrer_host",
} as const;
type Variant = DownloadSize;

export interface ActivityRow extends VisitorDisplay {
  id: string;
  createdAt: string;
  /** Null for anonymous / no visitor. */
  email: string | null;
  variant: string;
  photoId: string | null;
  name: string | null;
  set: string | null;
  bulk?: { scope: string | null; count: number; children: ActivityRow[] };
}

function parseCursor(v: string | null) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\|([\w-]{1,64})$/.exec(
    v ?? "",
  );
  return m ? { createdAt: m[1], id: m[2] } : undefined;
}

type QRow = Awaited<ReturnType<typeof activityQuery>>[number];

type TopRow = QRow;

/** Children (per-photo rows) and photo counts of the bulk headers on this page. */
async function loadBulkChildren(
  env: Env,
  id: string,
  pageRows: TopRow[],
  toRow: (r: QRow) => ActivityRow,
) {
  const db = getDb(env);
  const headerIds = pageRows.filter((r) => r.photoId === null).map((r) => r.id);
  const children = new Map<string, ActivityRow[]>();
  const counts = new Map<string, number>();
  if (headerIds.length) {
    const kids = await activityQuery(db, id, {
      bulkIds: headerIds,
      limit: CHILD_CAP,
    });
    for (const k of kids) {
      const list = children.get(k.bulkId!) ?? [];
      list.push(toRow(k));
      children.set(k.bulkId!, list);
    }
    const cs = await db
      .select({ b: schema.downloads.bulkId, n: sql<number>`COUNT(*)` })
      .from(schema.downloads)
      .where(
        and(
          eq(schema.downloads.galleryId, id),
          inArray(schema.downloads.bulkId, headerIds),
        ),
      )
      .groupBy(schema.downloads.bulkId);
    for (const c of cs) counts.set(c.b!, c.n);
  }
  return { children, counts };
}

async function loadSummary(env: Env, id: string) {
  const [sum] = (
    await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM gallery_views WHERE gallery_id = ?1) AS views,
        (SELECT COUNT(DISTINCT lower(email)) FROM visitors WHERE gallery_id = ?1 AND email NOT LIKE '%@anon.invalid') AS visitors,
        (SELECT COUNT(*) FROM downloads WHERE gallery_id = ?1 AND photo_id IS NOT NULL) AS photos,
        (SELECT COUNT(*) FROM downloads WHERE gallery_id = ?1 AND photo_id IS NULL AND kind = 'bulk') AS bulks`,
    )
      .bind(id)
      .all<{ views: number; visitors: number; photos: number; bulks: number }>()
  ).results;
  return sum;
}

async function loadVisitorOptions(env: Env, id: string) {
  const opts = await env.DB.prepare(
    `SELECT lower(v.email) AS email FROM visitors v
      WHERE v.gallery_id = ?1 AND v.email NOT LIKE '%@anon.invalid'
        AND EXISTS (SELECT 1 FROM downloads d WHERE d.visitor_id = v.id AND d.gallery_id = ?1)
      GROUP BY lower(v.email)
      ORDER BY lower(v.email)`,
  )
    .bind(id)
    .all<{ email: string }>();
  return opts;
}

async function loadRecentViews(env: Env, id: string) {
  const db = getDb(env);
  const views = await db
    .select({
      createdAt: schema.galleryViews.createdAt,
      ...visitorFields(schema.galleryViews),
      email: sql<
        string | null
      >`CASE WHEN ${schema.visitors.email} LIKE '%@anon.invalid' THEN NULL ELSE ${schema.visitors.email} END`,
    })
    .from(schema.galleryViews)
    .leftJoin(
      schema.visitors,
      and(
        eq(schema.visitors.id, schema.galleryViews.visitorId),
        eq(schema.visitors.galleryId, schema.galleryViews.galleryId),
      ),
    )
    .where(eq(schema.galleryViews.galleryId, id))
    .orderBy(desc(schema.galleryViews.createdAt))
    .limit(VIEWS_CAP);
  return views;
}

export async function loadActivity(env: Env, id: string, q: URLSearchParams) {
  const g = await loadGallery(env, id);
  if (!g) return null;
  const db = getDb(env);
  const visitorParam = (q.get("visitor") ?? "").trim().slice(0, 254);
  const sizeParam = q.get("size") ?? "";
  const variant = (DOWNLOAD_SIZES as readonly string[]).includes(sizeParam)
    ? (sizeParam as Variant)
    : undefined;
  const before = parseCursor(q.get("cursor"));

  const top = await activityQuery(db, id, {
    visitor: visitorParam || undefined,
    variant,
    before,
    topLevel: true,
    limit: ACTIVITY_PAGE + 1,
  });
  const pageRows = top.slice(0, ACTIVITY_PAGE);
  const last = pageRows[ACTIVITY_PAGE - 1];
  const next =
    top.length > ACTIVITY_PAGE ? `${last.createdAt}|${last.id}` : null;

  const photos = await photoMap(env, id);
  const toRow = (r: QRow): ActivityRow => {
    const p = r.photoId ? photos.get(r.photoId) : undefined;
    return {
      id: r.id,
      createdAt: r.createdAt,
      email: r.email,
      variant: r.variant,
      ...visitorDisplay(r),
      photoId: r.photoId,
      name: p?.name ?? null,
      set: p?.set ?? null,
    };
  };

  const { children, counts } = await loadBulkChildren(env, id, pageRows, toRow);
  const rows = pageRows.map((r) => {
    const row = toRow(r);
    if (r.photoId === null) {
      row.bulk = {
        scope: r.bulkScope,
        count: counts.get(r.id) ?? 0,
        children: children.get(r.id) ?? [],
      };
    }
    return row;
  });

  const sum = await loadSummary(env, id);
  const opts = await loadVisitorOptions(env, id);
  const views = await loadRecentViews(env, id);

  const breakdown = await visitBreakdown(env, id);

  return {
    gallery: g,
    breakdown,
    summary: {
      views: sum.views,
      visitors: sum.visitors,
      photos: sum.photos,
      bulks: sum.bulks,
    },
    rows,
    next,
    filters: { visitor: visitorParam, size: variant ?? "" },
    visitorOptions: opts.results.map((r) => r.email),
    views,
  };
}

export interface BreakdownEntry {
  value: string;
  count: number;
}

/** Top values of each visit dimension for one gallery (nulls skipped). */
async function visitBreakdown(env: Env, galleryId: string) {
  const entries = Object.entries(BREAKDOWN_COLUMNS);
  const results = await env.DB.batch<BreakdownEntry>(
    entries.map(([, col]) =>
      env.DB.prepare(
        `SELECT ${col} AS value, COUNT(*) AS count FROM gallery_views
          WHERE gallery_id = ?1 AND ${col} IS NOT NULL
          GROUP BY ${col} ORDER BY count DESC, value LIMIT ${BREAKDOWN_CAP}`,
      ).bind(galleryId),
    ),
  );
  return Object.fromEntries(
    entries.map(([key], i) => [key, results[i].results]),
  ) as Record<keyof typeof BREAKDOWN_COLUMNS, BreakdownEntry[]>;
}
