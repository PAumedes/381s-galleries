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

/**
 * Galleries on the public home (PLAN 5.8 "Public home"). The rules live in this
 * query, not in the admin UI: `show_on_home`, published, not expired, no PIN,
 * and a cover image that the public can actually be served (in Prueba only a
 * photo with preview-wm, so the cover is never a clean file). Evaluated on
 * every request, so a PIN or an unpublish hides a gallery at once.
 */
export async function loadHome(env: Env): Promise<{ items: HomeItem[] }> {
  const g = schema.galleries;
  const db = getDb(env);
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
      clientSlug: schema.clients.slug,
    })
    .from(g)
    .leftJoin(schema.clients, eq(g.clientId, schema.clients.id))
    .where(
      sql`${g.showOnHome} = 1 AND ${g.status} = 'published' AND ${g.pinHash} IS NULL`,
    )
    .orderBy(
      sql`COALESCE(NULLIF(${g.eventDate}, ''), ${g.createdAt}) DESC`,
      sql`${g.createdAt} DESC`,
      sql`${g.id}`,
    );
  const now = Date.now();
  const shown = rows
    .filter((r) => r.coverId !== null && !isExpired(r.expiresAt, now))
    .slice(0, HOME_CAP);
  if (!shown.length) return { items: [] };

  const photos = await db
    .select()
    .from(schema.photos)
    .where(
      inArray(
        schema.photos.id,
        shown.map((r) => r.coverId as string),
      ),
    );
  const byId = new Map(photos.map((p) => [p.id, p]));
  const items: HomeItem[] = [];
  for (const r of shown) {
    const p = byId.get(r.coverId as string);
    if (!p) continue;
    const v = await imageVersionToken(env, p, r.mode === "proofing");
    items.push({
      slug: r.slug,
      ...(r.clientSlug ? { clientSlug: r.clientSlug } : {}),
      title: r.title,
      eventDate: r.eventDate,
      cover: {
        id: p.id,
        ...(v ? { v } : {}),
        focus: focusOf(r.focusX, r.focusY),
        aspect: p.width && p.height ? p.width / p.height : null,
      },
    });
  }
  return { items };
}
