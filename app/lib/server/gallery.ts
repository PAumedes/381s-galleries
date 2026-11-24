import type { schema } from "../../db";
import type { Palette } from "../design";
import {
  crossSite,
  findGallery,
  isAvailable,
  isSecure,
  openGallery,
} from "./access";
import type { AccessEnv } from "./access";
import {
  buildOpenData,
  OG_LONG_EDGE,
  type OpenData,
} from "./gallery-open-data";
import { recordView } from "./gallery-views";

type GalleryEnv = AccessEnv;
type GalleryRow = typeof schema.galleries.$inferSelect;

// Re-exported for existing importers.
export { crossSite, findGallery, isAvailable, isSecure };
export { buildOpenData, OG_LONG_EDGE };
export { VIEW_DEDUPE_MS, insertViewOnce } from "./gallery-views";
export {
  PIN_GALLERY_MAX_ATTEMPTS,
  PIN_MAX_ATTEMPTS,
  PIN_WINDOW_MS,
  unlockGallery,
  type UnlockResult,
} from "./gallery-pin";

export type GalleryData =
  | { state: "unavailable" }
  | { state: "locked"; slug: string; title: string; palette: Palette }
  | ({ state: "open" } & OpenData);

export type LoadResult = {
  status: 200 | 404;
  data: GalleryData;
  /** Set-Cookie value to send (session `viewed` flag), if any. */
  setCookie?: string;
};

const unavailable = (): LoadResult => ({
  status: 404,
  data: { state: "unavailable" },
});

export async function loadGallery(
  request: Request,
  slug: string,
  env: GalleryEnv,
  /** The row the caller already fetched (T6.40d: one joined lookup). */
  preloaded?: { gallery: GalleryRow | undefined },
): Promise<LoadResult> {
  // Slugs with a dot are files (favicon.ico, robots.txt, ...), never galleries.
  if (slug.includes(".")) return unavailable();
  const g = preloaded ? preloaded.gallery : await findGallery(env, slug);
  if (!isAvailable(g)) return unavailable();

  const open = await openGallery(request, g, env);
  if (!open) {
    return {
      status: 200,
      data: {
        state: "locked",
        slug: g.slug,
        title: g.title,
        palette: g.palette,
      },
    };
  }
  const built = await buildOpenData(env as Env, g);
  const setCookie = await recordView(request, env, g, open.session);

  return {
    status: 200,
    data: { state: "open", ...built },
    ...(setCookie ? { setCookie } : {}),
  };
}
