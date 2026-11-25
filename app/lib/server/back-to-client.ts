import { PAGE_PARAM } from "../page-param";
import { isPinned } from "./access";
import { parsePageParam } from "./client-page";
import {
  CLIENT_CANDIDATE_CAP,
  CLIENT_PAGE_SIZE,
  listedOnClientPage,
} from "./home";
import { sameClient, type GalleryHit } from "./gallery-resolve";

/** "Back to the client page" link of an album (T6.50). */
export type BackToClient = { name: string; href: string };

/** Last page a client page can have: a forged larger number gives the bare link. */
const MAX_PAGE = Math.ceil(CLIENT_CANDIDATE_CAP / CLIENT_PAGE_SIZE);

/** The Referer as a same-origin URL of this request's site, else null. */
function sameSiteReferer(request: Request): URL | null {
  const raw = request.headers.get("Referer");
  if (!raw) return null;
  let ref: URL;
  try {
    ref = new URL(raw);
  } catch {
    return null;
  }
  const here = new URL(request.url);
  if (ref.origin !== here.origin || ref.username || ref.password) return null;
  return ref;
}

/**
 * The link back to the client page the visitor came from, or undefined.
 * Shown only when the Referer is the same site's `/<client>` page (exact path,
 * NOCASE, optional `?pagina=N`) of the client that owns THIS album and that
 * page is enabled AND lists this album (`listedOnClientPage`: cover or PIN, not
 * expired), so a forged Referer can never name a client whose page is a 404.
 * `coverId` is the album's resolved cover from the payload already loaded
 * (null when it has none). A direct open (no Referer) learns nothing.
 */
export function backToClient(
  request: Request,
  hit: GalleryHit | undefined,
  coverId: string | null,
): BackToClient | undefined {
  if (!hit?.clientSlug || !hit.clientName || !hit.clientPageEnabled) return;
  const g = hit.gallery;
  const listed = listedOnClientPage(
    {
      status: g.status,
      expiresAt: g.expiresAt,
      coverId,
      pinned: isPinned(g),
    },
    Date.now(),
  );
  if (!listed) return;
  const ref = sameSiteReferer(request);
  const seg = ref && /^\/([^/]+)$/.exec(ref.pathname)?.[1];
  if (!seg || !sameClient(seg, hit.clientSlug)) return;
  const page = parsePageParam(ref.searchParams.getAll(PAGE_PARAM));
  const base = `/${encodeURIComponent(hit.clientSlug)}`;
  return {
    name: hit.clientName,
    href: page > 1 && page <= MAX_PAGE ? `${base}?${PAGE_PARAM}=${page}` : base,
  };
}
