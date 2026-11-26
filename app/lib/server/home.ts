import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { allTiffNoPreviewSql, focusOf, homeCoverIdSql } from "./cover";
import { imageVersionToken } from "./images";
import { isExpired } from "./time";

/** Most galleries shown on the public home. */
export const HOME_CAP = 60;
/** Albums per page of a client's homepage (T6.49); also the covers query size (<= 100 binds). */
export const CLIENT_PAGE_SIZE = 60;
/**
 * Most LISTABLE albums one client page lists (newest first). It counts only
 * albums that pass `listedOnClientPage`, applied after the filter, so expired
 * or cover-less albums never hide older valid ones. The SQL has no limit: the
 * rows carry no cover bytes (a few hundred bytes each).
 */
export const CLIENT_CANDIDATE_CAP = 1000;

/**
 * Public payload of one home tile. Deliberately tiny: no client name, Drive
 * ids, PIN info or status. `cover.id` is the same opaque photo id the gallery
 * page already puts in its image URLs.
 */
export interface HomeItem {
  slug: string;
  /** Public slug of the album's client folder (T6.40): link is /<client>/<slug>. */
  clientSlug?: string;
  title: string;
  eventDate: string | null;
  cover: {
    id: string;
    /** Image version token (`?v=`), absent when a source version is unknown. */
    v?: string;
    /** Focal point on the image (percent), null = centered. */
    focus: { x: number; y: number } | null;
    /** Photo width / height, null when unknown. */
    aspect: number | null;
  };
}

/** Which albums a listing covers: the studio home, or one client's page. */
type Scope = { kind: "home" } | { kind: "client"; slug: string };

/**
 * Albums for the public home (PLAN 5.8 "Public home"). The rules live in this
 * query, not in the admin UI: `show_on_home`, published, not expired, no PIN,
 * and a cover image that the public can actually be served (in Prueba only a
 * photo with preview-wm, so the cover is never a clean file). Evaluated on
 * every request, so a PIN or an unpublish hides a gallery at once.
 */
export async function loadHome(env: Env): Promise<{ items: HomeItem[] }> {
  const { tiles } = await loadTiles(env, { kind: "home" });
  return {
    items: tiles.flatMap(({ cover, ...rest }) =>
      cover ? [{ ...rest, cover }] : [],
    ),
  };
}

/** A tile of the client page: PIN albums have no cover (it would bypass the PIN). */
export type ClientTile = Omit<HomeItem, "cover"> & {
  cover: HomeItem["cover"] | null;
  locked?: true;
  /** Every photo is a TIFF with nothing to show (T6.53d2): title-only tile, no cover. */
  tiffOnly?: true;
};

/**
 * Tiles of one client's page (T6.40e): every published, unexpired album of the
 * client with a cover, regardless of show_on_home; PIN albums
 * are listed too (owner decision), without a cover. `null` when the client does
 * not exist or has `page_enabled = 0`, or when `page` is beyond the last one
 * (T6.49: `CLIENT_PAGE_SIZE` per page); the caller adds the "no tiles" 404.
 */
export async function loadClientTiles(
  env: Env,
  slug: string,
  page = 1,
): Promise<{
  clientName: string;
  clientSlug: string;
  tiles: ClientTile[];
  page: number;
  pageCount: number;
} | null> {
  const r = await loadTiles(env, { kind: "client", slug }, page);
  return r.client
    ? { ...r.client, tiles: r.tiles, page, pageCount: r.pageCount }
    : null;
}

/**
 * The client-page rule on one album (T6.46): published, not expired, and a
 * cover, a PIN (locked tile) or only TIFF photos with no image (T6.53d2:
 * title-only tile). Used by the page, the admin status line and the album's
 * back-to-client link.
 */
export function listedOnClientPage(
  r: {
    status: string;
    expiresAt: string | null;
    coverId: string | null;
    pinned: boolean | number;
    tiffOnly?: boolean | number;
  },
  now: number,
): boolean {
  return (
    r.status === "published" &&
    (r.coverId !== null || !!r.pinned || !!r.tiffOnly) &&
    !isExpired(r.expiresAt, now)
  );
}

type Db = ReturnType<typeof getDb>;
type TileRow = Awaited<ReturnType<typeof queryTileRows>>[number];

/**
 * The albums a client page lists: the `listedOnClientPage` rule, then the
 * `CLIENT_CANDIDATE_CAP` newest (rows arrive newest first). `capped` is true
 * when more listable albums exist than the cap. One rule for page and admin.
 */
export function listClientAlbums<
  R extends Parameters<typeof listedOnClientPage>[0],
>(rows: R[], now: number): { listed: R[]; capped: boolean } {
  const all = rows.filter((r) => listedOnClientPage(r, now));
  return {
    listed: all.slice(0, CLIENT_CANDIDATE_CAP),
    capped: all.length > CLIENT_CANDIDATE_CAP,
  };
}

/** Candidate albums of a scope, newest event first (cover rule in `homeCoverIdSql`). */
async function queryTileRows(db: Db, scope: Scope) {
  const g = schema.galleries;
  const c = schema.clients;
  return db
    .select({
      slug: g.slug,
      status: g.status,
      title: g.title,
      eventDate: g.eventDate,
      expiresAt: g.expiresAt,
      mode: g.mode,
      focusX: g.coverFocusX,
      focusY: g.coverFocusY,
      // Cover: chosen photo when visible (and servable), else the first one,
      // in the same order as the gallery page.
      coverId: homeCoverIdSql(),
      // Locked tile: the album's own PIN or its client's (a client PIN also
      // protects the covers, which /img refuses without the unlock).
      pinned: sql<number>`(${g.pinHash} IS NOT NULL OR ${c.pinHash} IS NOT NULL)`,
      // No cover because every photo is a TIFF with no image (T6.53d2).
      tiffOnly: allTiffNoPreviewSql(),
      clientSlug: c.slug,
      clientName: c.name,
    })
    .from(g)
    .leftJoin(c, eq(g.clientId, c.id))
    .where(
      scope.kind === "home"
        ? sql`${g.showOnHome} = 1 AND ${g.status} = 'published' AND ${g.pinHash} IS NULL AND ${c.pinHash} IS NULL`
        : // A client's page lists all its published albums, whatever show_on_home
          // says (that flag is only for the studio home); PIN albums show locked.
          sql`${g.status} = 'published' AND ${c.pageEnabled} = 1 AND ${c.slug} = ${scope.slug} COLLATE NOCASE`,
    )
    .orderBy(
      sql`COALESCE(NULLIF(${g.eventDate}, ''), ${g.createdAt}) DESC`,
      sql`${g.createdAt} DESC`,
      sql`${g.id}`,
    );
}

/** The cover photos of the unlocked tiles, by id (one query, none when nothing to fetch). */
async function loadCoverPhotos(db: Db, shown: TileRow[]) {
  const covered = shown.filter((r) => !r.pinned && r.coverId !== null);
  if (!covered.length)
    return new Map<string, typeof schema.photos.$inferSelect>();
  const photos = await db
    .select()
    .from(schema.photos)
    .where(
      inArray(
        schema.photos.id,
        covered.map((r) => r.coverId as string),
      ),
    );
  return new Map(photos.map((p) => [p.id, p]));
}

async function buildTile(
  env: Env,
  r: TileRow,
  p: typeof schema.photos.$inferSelect | undefined,
): Promise<ClientTile> {
  const v = p && (await imageVersionToken(env, p, r.mode === "proofing"));
  return {
    slug: r.slug,
    ...(r.clientSlug ? { clientSlug: r.clientSlug } : {}),
    title: r.title,
    // the PIN gate hides the event date; a locked tile must not reveal more
    eventDate: r.pinned ? null : r.eventDate,
    cover: p
      ? {
          id: p.id,
          ...(v ? { v } : {}),
          focus: focusOf(r.focusX, r.focusY),
          aspect: p.width && p.height ? p.width / p.height : null,
        }
      : null,
    ...(r.pinned ? { locked: true as const } : {}),
    ...(!r.pinned && !p ? { tiffOnly: true as const } : {}),
  };
}

async function loadTiles(
  env: Env,
  scope: Scope,
  page = 1,
): Promise<{
  tiles: ClientTile[];
  client?: { clientName: string; clientSlug: string };
  pageCount: number;
}> {
  const db = getDb(env);
  const home = scope.kind === "home";
  const rows = await queryTileRows(db, scope);
  const now = Date.now();
  const listed = home
    ? rows.filter((r) => r.coverId !== null && !isExpired(r.expiresAt, now))
    : listClientAlbums(rows, now).listed;
  const size = home ? HOME_CAP : CLIENT_PAGE_SIZE;
  const pageCount = home ? 1 : Math.ceil(listed.length / size);
  const shown = listed.slice((page - 1) * size, page * size);
  const client = shown[0]
    ? { clientName: shown[0].clientName!, clientSlug: shown[0].clientSlug! }
    : undefined;
  const byId = await loadCoverPhotos(db, shown);
  const tiles: ClientTile[] = [];
  for (const r of shown) {
    const p = r.coverId && !r.pinned ? byId.get(r.coverId) : undefined;
    if (!r.pinned && !p && !r.tiffOnly) continue;
    tiles.push(await buildTile(env, r, p));
  }
  return { tiles, client, pageCount };
}
