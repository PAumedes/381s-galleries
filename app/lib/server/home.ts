import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { focusOf, homeCoverIdSql } from "./cover";
import { imageVersionToken } from "./images";
import { isExpired } from "./time";

/** Most galleries shown on the public home. */
export const HOME_CAP = 60;

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
};

/**
 * Tiles of one client's page (T6.40e): the home rules, except that PIN albums
 * are listed too (owner decision), without a cover. `null` when the client does
 * not exist or has `page_enabled = 0`; the caller adds the "no tiles" 404.
 */
export async function loadClientTiles(
  env: Env,
  slug: string,
): Promise<{
  clientName: string;
  clientSlug: string;
  tiles: ClientTile[];
} | null> {
  const r = await loadTiles(env, { kind: "client", slug });
  return r.client ? { ...r.client, tiles: r.tiles } : null;
}

async function loadTiles(
  env: Env,
  scope: Scope,
): Promise<{
  tiles: ClientTile[];
  client?: { clientName: string; clientSlug: string };
}> {
  const g = schema.galleries;
  const db = getDb(env);
  const c = schema.clients;
  const home = scope.kind === "home";
  // Cover: chosen photo when visible (and servable), else the first one, in the
  // same order as the gallery page.
  const cover = homeCoverIdSql();
  const rows = await db
    .select({
      slug: g.slug,
      title: g.title,
      eventDate: g.eventDate,
      expiresAt: g.expiresAt,
      mode: g.mode,
      focusX: g.coverFocusX,
      focusY: g.coverFocusY,
      coverId: cover,
      pinned: sql<number>`${g.pinHash} IS NOT NULL`,
      clientSlug: c.slug,
      clientName: c.name,
    })
    .from(g)
    .leftJoin(c, eq(g.clientId, c.id))
    .where(
      home
        ? sql`${g.showOnHome} = 1 AND ${g.status} = 'published' AND ${g.pinHash} IS NULL`
        : // PIN albums are always listed (locked): the admin clears and refuses show_on_home for them.
          sql`(${g.showOnHome} = 1 OR ${g.pinHash} IS NOT NULL) AND ${g.status} = 'published' AND ${c.pageEnabled} = 1 AND ${c.slug} = ${scope.slug} COLLATE NOCASE`,
    )
    .orderBy(
      sql`COALESCE(NULLIF(${g.eventDate}, ''), ${g.createdAt}) DESC`,
      sql`${g.createdAt} DESC`,
      sql`${g.id}`,
    );
  const now = Date.now();
  const shown = rows
    .filter(
      (r) =>
        (r.coverId !== null || (!home && r.pinned)) &&
        !isExpired(r.expiresAt, now),
    )
    .slice(0, HOME_CAP);
  const client = shown[0]
    ? { clientName: shown[0].clientName!, clientSlug: shown[0].clientSlug! }
    : undefined;
  const covered = shown.filter((r) => !r.pinned);
  const photos = covered.length
    ? await db
        .select()
        .from(schema.photos)
        .where(
          inArray(
            schema.photos.id,
            covered.map((r) => r.coverId as string),
          ),
        )
    : [];
  const byId = new Map(photos.map((p) => [p.id, p]));
  const tiles: ClientTile[] = [];
  for (const r of shown) {
    const p = r.pinned ? undefined : byId.get(r.coverId as string);
    if (!r.pinned && !p) continue;
    const v = p && (await imageVersionToken(env, p, r.mode === "proofing"));
    tiles.push({
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
    });
  }
  return { tiles, client };
}
