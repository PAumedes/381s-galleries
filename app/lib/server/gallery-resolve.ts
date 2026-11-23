import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { galleryPath } from "../gallery-path";
import { isAvailable, type AccessEnv, type GalleryRow } from "./access";
import { RESERVED_SLUGS } from "./slug";

/** What the URL names: `/:album` (no client) or `/:client/:album`. */
export type GalleryTarget = { client?: string; album: string };

export type GalleryHit = { gallery: GalleryRow; clientSlug: string | null };

/** The album and its client's slug in ONE query (left join). */
export async function findGalleryWithClient(
  env: AccessEnv,
  slug: string,
): Promise<GalleryHit | undefined> {
  const [row] = await getDb(env as Env)
    .select({ gallery: schema.galleries, clientSlug: schema.clients.slug })
    .from(schema.galleries)
    .leftJoin(schema.clients, eq(schema.galleries.clientId, schema.clients.id))
    .where(sql`${schema.galleries.slug} = ${slug} COLLATE NOCASE`);
  return row;
}

/** True when the URL's client segment names this album's client (NOCASE). */
export function sameClient(
  wanted: string | undefined,
  actual: string | null,
): boolean {
  return wanted === undefined
    ? actual === null
    : actual !== null && actual.toLowerCase() === wanted.toLowerCase();
}

export type Resolution =
  /** Send the visitor to `path` (302); the caller keeps the query string. */
  | { kind: "redirect"; path: string }
  /** Render in place; `hit` undefined = nothing to find (404 page). */
  | { kind: "serve"; hit: GalleryHit | undefined };

const NOT_FOUND: Resolution = { kind: "serve", hit: undefined };

/**
 * Decides what a gallery URL does (T6.40d). Only AVAILABLE albums redirect, so
 * a draft/archived/expired/unknown one is the same 404 whatever the URL says
 * (no client slug leaks). Reserved and file-like client segments are 404
 * before any query. Slugs with a dot are files, never albums.
 */
export async function resolveGallery(
  env: AccessEnv,
  { client, album }: GalleryTarget,
): Promise<Resolution> {
  if (album.includes(".")) return NOT_FOUND;
  if (
    client !== undefined &&
    (client.includes(".") || RESERVED_SLUGS.includes(client.toLowerCase()))
  )
    return NOT_FOUND;
  const hit = await findGalleryWithClient(env, album);
  if (!hit || !isAvailable(hit.gallery)) return { kind: "serve", hit };
  if (sameClient(client, hit.clientSlug)) return { kind: "serve", hit };
  return {
    kind: "redirect",
    path: galleryPath(hit.gallery.slug, hit.clientSlug),
  };
}
