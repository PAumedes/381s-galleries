import { PAGE_PARAM } from "../page-param";
import { isPinned, isSecure } from "./access";
import { backCookie, readBackPage } from "./back-to-client-cookie";
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

/** The page number of a Referer that is this client's own page (`/<client>`), else null. */
function clientPageOfReferer(
  request: Request,
  clientSlug: string,
): number | null {
  const ref = sameSiteReferer(request);
  const seg = ref && /^\/([^/]+)$/.exec(ref.pathname)?.[1];
  if (!ref || !seg || !sameClient(seg, clientSlug)) return null;
  return parsePageParam(ref.searchParams.getAll(PAGE_PARAM));
}

/** Where the link goes: a page beyond the last possible one gives the bare URL. */
function backHref(clientSlug: string, page: number): string {
  const base = `/${encodeURIComponent(clientSlug)}`;
  return page > 1 && page <= MAX_PAGE ? `${base}?${PAGE_PARAM}=${page}` : base;
}

export type BackLink = { link?: BackToClient; setCookie?: string };

/**
 * The link back to the client page the visitor came from, plus the cookie to
 * set, or `{}`. Shown only for an album the client page lists
 * (`listedOnClientPage`: published, not expired, cover or PIN) of an enabled
 * client page, so a forged Referer or cookie can never name a client whose
 * page is a 404. `coverId` is the album's resolved cover from the payload
 * already loaded (null when it has none).
 *
 * The visitor proves they came from the page with the Referer: the same-site
 * `/<client>` URL of the client that owns THIS album (exact path, NOCASE,
 * optional `?pagina=N`); that sets the cookie. Without such a Referer (reload,
 * the PIN form's POST + redirect, the language switch) the signed cookie of
 * that same client brings the link back. A direct open (no Referer, no
 * cookie) learns nothing. No D1 query: everything comes from the album lookup.
 */
export async function backLink(
  request: Request,
  hit: GalleryHit | undefined,
  coverId: string | null,
  env: Pick<Env, "SESSION_SECRET">,
): Promise<BackLink> {
  if (!hit?.clientSlug || !hit.clientName || !hit.clientPageEnabled) return {};
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
  if (!listed || !g.clientId) return {};
  const make = (page: number): BackToClient => ({
    name: hit.clientName!,
    href: backHref(hit.clientSlug!, page),
  });
  const seen = clientPageOfReferer(request, hit.clientSlug);
  if (seen !== null)
    return {
      link: make(seen),
      setCookie: await backCookie(g.clientId, seen, env, {
        secure: isSecure(request),
      }),
    };
  const kept = await readBackPage(request, g.clientId, env);
  return kept === null ? {} : { link: make(kept) };
}
