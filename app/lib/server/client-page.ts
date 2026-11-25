import { loadClientTiles, type ClientTile } from "./home";
import { isAllowedSlug } from "./slug";

/** Public payload of a client's homepage `/:client` (T6.40e). */
export type ClientPageData = {
  state: "client";
  clientName: string;
  clientSlug: string;
  /** No Drive ids, PIN data or status: slug, title, date, cover (none when PIN). */
  items: ClientTile[];
  /** 1-based page shown and how many there are (T6.49). */
  page: number;
  pageCount: number;
};

/**
 * Page number from every `pagina` value of the URL: only ONE canonical positive
 * integer ("2", not "02", "2.5", " 2", "+2") counts; anything else is page 1.
 */
export function parsePageParam(values: string[]): number {
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) return 1;
  return Number(values[0]);
}

/**
 * The client homepage for a `/:slug` that matched no album, or null (the normal
 * 404, so a missing client, `page_enabled = 0` and "nothing visible" look the
 * same). Anything that can never be a client slug (bad format, too long, dotted
 * file names, reserved names) is never looked up (no query). A `page` beyond
 * the last is the same null (T6.49).
 */
export async function loadClientPage(
  env: Env,
  slug: string,
  page = 1,
): Promise<ClientPageData | null> {
  if (!isAllowedSlug(slug.toLowerCase())) return null;
  const found = await loadClientTiles(env, slug, page);
  if (!found || !found.tiles.length) return null;
  return {
    state: "client",
    clientName: found.clientName,
    clientSlug: found.clientSlug,
    items: found.tiles,
    page: found.page,
    pageCount: found.pageCount,
  };
}
