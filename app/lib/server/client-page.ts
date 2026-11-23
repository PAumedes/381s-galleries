import { loadClientTiles, type ClientTile } from "./home";
import { isAllowedSlug } from "./slug";

/** Public payload of a client's homepage `/:client` (T6.40e). */
export type ClientPageData = {
  state: "client";
  clientName: string;
  clientSlug: string;
  /** No Drive ids, PIN data or status: slug, title, date, cover (none when PIN). */
  items: ClientTile[];
};

/**
 * The client homepage for a `/:slug` that matched no album, or null (the normal
 * 404, so a missing client, `page_enabled = 0` and "nothing visible" look the
 * same). Anything that can never be a client slug (bad format, too long, dotted
 * file names, reserved names) is never looked up (no query).
 */
export async function loadClientPage(
  env: Env,
  slug: string,
): Promise<ClientPageData | null> {
  if (!isAllowedSlug(slug.toLowerCase())) return null;
  const page = await loadClientTiles(env, slug);
  if (!page || !page.tiles.length) return null;
  return {
    state: "client",
    clientName: page.clientName,
    clientSlug: page.clientSlug,
    items: page.tiles,
  };
}
