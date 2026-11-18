import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, photoVisible, schema } from "../../db";
import {
  CSV_BOM,
  anonLabel,
  csvLine,
  fmtBaSeconds,
  namesTxt,
} from "../admin-activity";
import { allMessages } from "../../i18n/dictionaries";
import { DEFAULT_LANG, type Lang } from "../../i18n/lang";
import { makeT } from "../../i18n/t";
import { isAnon } from "./access";
import { activityQuery, visitorFields } from "./activity";
import { adminHeaders } from "./admin";

export const ACTIVITY_PAGE = 50;
const CHILD_CAP = 1000;
const VIEWS_CAP = 50;
const CSV_CHUNK = 200;
const BREAKDOWN_CAP = 5;
/** Per-gallery summary: key -> `gallery_views` column (fixed list, never user input). */
const BREAKDOWN_COLUMNS = {
  countries: "country",
  devices: "device",
  browsers: "browser",
  referrers: "referrer_host",
} as const;
const VARIANTS = ["highres", "web", "ig"] as const;
type Variant = (typeof VARIANTS)[number];

export interface ActivityRow {
  id: string;
  createdAt: string;
  /** Null for anonymous / no visitor. */
  email: string | null;
  variant: string;
  country: string | null;
  region: string | null;
  city: string | null;
  lang: string | null;
  referrerHost: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  device: string | null;
  photoId: string | null;
  name: string | null;
  set: string | null;
  bulk?: { scope: string | null; count: number; children: ActivityRow[] };
}

async function loadGallery(env: Env, id: string) {
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

async function photoMap(env: Env, galleryId: string) {
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

function parseCursor(v: string | null) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\|([\w-]{1,64})$/.exec(
    v ?? "",
  );
  return m ? { createdAt: m[1], id: m[2] } : undefined;
}

type QRow = Awaited<ReturnType<typeof activityQuery>>[number];

export async function loadActivity(env: Env, id: string, q: URLSearchParams) {
  const g = await loadGallery(env, id);
  if (!g) return null;
  const db = getDb(env);
  const visitorParam = (q.get("visitor") ?? "").trim().slice(0, 254);
  const sizeParam = q.get("size") ?? "";
  const variant = (VARIANTS as readonly string[]).includes(sizeParam)
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
      country: r.country,
      region: r.region,
      city: r.city,
      lang: r.lang,
      referrerHost: r.referrerHost,
      browser: r.browser,
      browserVersion: r.browserVersion,
      os: r.os,
      device: r.device,
      photoId: r.photoId,
      name: p?.name ?? null,
      set: p?.set ?? null,
    };
  };

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

  const opts = await env.DB.prepare(
    `SELECT lower(v.email) AS email FROM visitors v
      WHERE v.gallery_id = ?1 AND v.email NOT LIKE '%@anon.invalid'
        AND EXISTS (SELECT 1 FROM downloads d WHERE d.visitor_id = v.id AND d.gallery_id = ?1)
      GROUP BY lower(v.email)
      ORDER BY lower(v.email)`,
  )
    .bind(id)
    .all<{ email: string }>();

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

/** CSV of every download row, newest first, streamed in keyset pages. */
export async function activityCsv(
  env: Env,
  id: string,
  lang: Lang = DEFAULT_LANG,
): Promise<Response | null> {
  const g = await loadGallery(env, id);
  if (!g) return null;
  const t = makeT(lang, allMessages(lang));
  const sizeLabel = (v: string) =>
    v === "highres"
      ? t("admin.size.highres")
      : v === "web"
        ? t("admin.size.web")
        : v === "ig"
          ? t("admin.size.ig")
          : v;
  const kindLabel = (v: string) =>
    v === "single"
      ? t("admin.export.kind.single")
      : v === "bulk"
        ? t("admin.export.kind.bulk")
        : v;
  const db = getDb(env);
  const photos = await photoMap(env, id);
  const enc = new TextEncoder();
  let cursor: { createdAt: string; id: string } | undefined;
  let started = false;
  let done = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (!started) {
        started = true;
        ctrl.enqueue(
          enc.encode(
            CSV_BOM +
              csvLine([
                t("admin.export.col.when_utc"),
                t("admin.export.col.when_ar"),
                t("admin.export.col.email"),
                t("admin.export.col.photo"),
                t("admin.export.col.set"),
                t("admin.export.col.size"),
                t("admin.export.col.kind"),
                t("admin.export.col.bulkId"),
                t("admin.export.col.country"),
                t("admin.export.col.region"),
                t("admin.export.col.city"),
                t("admin.export.col.continent"),
                t("admin.export.col.timezone"),
                t("admin.export.col.asn"),
                t("admin.export.col.asOrg"),
                t("admin.export.col.lang"),
                t("admin.export.col.referrer"),
                t("admin.export.col.browser"),
                t("admin.export.col.browserVersion"),
                t("admin.export.col.os"),
                t("admin.export.col.device"),
              ]),
          ),
        );
        return;
      }
      if (done) return ctrl.close();
      const rows = await activityQuery(db, id, {
        before: cursor,
        limit: CSV_CHUNK,
      });
      let out = "";
      for (const r of rows) {
        const p = r.photoId ? photos.get(r.photoId) : undefined;
        out += csvLine([
          r.createdAt,
          fmtBaSeconds(r.createdAt),
          r.email,
          p?.name,
          p?.set,
          sizeLabel(r.variant),
          kindLabel(r.kind),
          r.photoId === null ? r.id : r.bulkId,
          r.country,
          r.region,
          r.city,
          r.continent,
          r.timezone,
          r.asn,
          r.asOrg,
          r.lang,
          r.referrerHost,
          r.browser,
          r.browserVersion,
          r.os,
          r.device,
        ]);
      }
      if (out) ctrl.enqueue(enc.encode(out));
      if (rows.length < CSV_CHUNK) {
        done = true;
        return ctrl.close();
      }
      const l = rows[rows.length - 1];
      cursor = { createdAt: l.createdAt, id: l.id };
    },
  });
  return new Response(body, {
    headers: {
      ...adminHeaders(),
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${g.slug}-${t("admin.export.file.activity")}.csv"`,
    },
  });
}

// -------------------------------------------------------------- favorites

export interface FavPhoto {
  id: string;
  name: string;
  set: string;
  /** Photo in its sync grace period (hidden from clients, gone for Capture One). */
  hidden: boolean;
}

async function favoriteRows(env: Env, galleryId: string) {
  return getDb(env)
    .select({
      visitorId: schema.favorites.visitorId,
      email: schema.visitors.email,
      listName: schema.favorites.listName,
      createdAt: schema.favorites.createdAt,
      photoId: schema.photos.id,
      name: schema.photos.baseName,
      set: schema.photos.setName,
      visible: sql<number>`(${photoVisible})`,
    })
    .from(schema.favorites)
    .innerJoin(
      schema.visitors,
      and(
        eq(schema.visitors.id, schema.favorites.visitorId),
        eq(schema.visitors.galleryId, schema.favorites.galleryId),
      ),
    )
    .innerJoin(
      schema.photos,
      and(
        eq(schema.photos.id, schema.favorites.photoId),
        eq(schema.photos.galleryId, schema.favorites.galleryId),
      ),
    )
    .where(eq(schema.favorites.galleryId, galleryId))
    .orderBy(
      asc(schema.photos.setName),
      asc(schema.photos.sort),
      asc(schema.photos.baseName),
    );
}

export async function loadFavoritesAdmin(env: Env, id: string) {
  const g = await loadGallery(env, id);
  if (!g) return null;
  const rows = await favoriteRows(env, id);
  const by = new Map<
    string,
    {
      id: string;
      label: string;
      anon: boolean;
      lists: Map<string, { name: string; last: string; photos: FavPhoto[] }>;
    }
  >();
  const picks = new Map<string, { photo: FavPhoto; visitors: Set<string> }>();
  for (const r of rows) {
    const anon = isAnon(r.email);
    // Per-device visitors: one person per (lowercased) email in admin.
    const person = anon ? r.visitorId : r.email.toLowerCase();
    let v = by.get(person);
    if (!v) {
      v = {
        id: person,
        label: anon ? anonLabel(r.visitorId) : r.email,
        anon,
        lists: new Map(),
      };
      by.set(person, v);
    }
    let l = v.lists.get(r.listName);
    if (!l) {
      l = { name: r.listName, last: r.createdAt, photos: [] };
      v.lists.set(r.listName, l);
    }
    if (r.createdAt > l.last) l.last = r.createdAt;
    const photo: FavPhoto = {
      id: r.photoId,
      name: r.name,
      set: r.set,
      hidden: !r.visible,
    };
    // Two devices of one person favouriting the same photo is one pick.
    if (!l.photos.some((x) => x.id === photo.id)) l.photos.push(photo);
    const p = picks.get(r.photoId) ?? { photo, visitors: new Set() };
    p.visitors.add(person);
    picks.set(r.photoId, p);
  }
  const visitors = [...by.values()]
    .map((v) => ({
      id: v.id,
      label: v.label,
      anon: v.anon,
      lists: [...v.lists.values()]
        .map((l) => ({
          name: l.name,
          count: l.photos.length,
          last: l.last,
          photos: l.photos,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, "es", { sensitivity: "base" }),
    );
  const all = [...picks.values()]
    .map((p) => ({ ...p.photo, picks: p.visitors.size }))
    .sort((a, b) => b.picks - a.picks || a.name.localeCompare(b.name, "es"));
  return { gallery: g, visitors, all };
}

/** `.txt` for Capture One: one base name per line, existing photos only. Null = unknown gallery/visitor. */
export async function favoritesTxt(
  env: Env,
  id: string,
  visitorId: string | null,
  lang: Lang = DEFAULT_LANG,
): Promise<Response | null> {
  const g = await loadGallery(env, id);
  if (!g) return null;
  const t = makeT(lang, allMessages(lang));
  let rows = await favoriteRows(env, id);
  if (visitorId) {
    // `visitorId` is a person key: an anonymous visitor id or a (lowercased) email.
    const key = visitorId.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.visitorId === visitorId ||
        (!isAnon(r.email) && r.email.toLowerCase() === key),
    );
    if (rows.length === 0) return null;
  }
  const names = [...new Set(rows.filter((r) => r.visible).map((r) => r.name))];
  const suffix = visitorId
    ? `-${visitorId.slice(0, 8).replace(/[^\w-]/g, "")}`
    : "";
  return new Response(namesTxt(names), {
    headers: {
      ...adminHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${g.slug}-${t("admin.export.file.favorites")}${suffix}.txt"`,
    },
  });
}
