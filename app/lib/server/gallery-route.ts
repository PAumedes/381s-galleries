import { data, redirect, type RouterContextProvider } from "react-router";

import { enPublic } from "../../i18n/en.public";
import { esPublic } from "../../i18n/es.public";
import { getLang, langCookie } from "../../i18n/lang";
import { makeT } from "../../i18n/t";
import { executionContext } from "./context";
import { getDrive } from "./drive-factory";
import { loadGallery, unlockGallery, type GalleryData } from "./gallery";
import { warmGalleryOnOpen } from "./gallery-warm";
import { resolveGallery, type GalleryTarget } from "./gallery-resolve";
import {
  loadClientPage,
  parsePageParam,
  type ClientPageData,
} from "./client-page";
import { PAGE_PARAM } from "../page-param";
import { NOSNIFF, PRIVATE_NO_STORE } from "./http";
import { publicOrigin } from "./public-url";

/** What `/:slug` and `/:client/:album` loaders return (the page's data). */
export type GalleryRouteData = (GalleryData | ClientPageData) & {
  origin: string;
  /** Owning client's slug; never on an unavailable page (no leak). */
  clientSlug?: string;
};

type Args = { request: Request; context: Readonly<RouterContextProvider> };
type RouteEnv = Env;

const SECURITY_HEADERS = {
  "Cache-Control": PRIVATE_NO_STORE,
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  ...NOSNIFF,
  "X-Robots-Tag": "noindex, nofollow",
};

function baseHeaders(request: Request): Headers {
  const h = new Headers(SECURITY_HEADERS);
  const url = new URL(request.url);
  if (url.searchParams.has("lang")) {
    h.append("Set-Cookie", langCookie(getLang(request)));
  }
  return h;
}

/**
 * Loader shared by `/:slug` and `/:client/:album`. The URL decides first
 * (`resolveGallery`: 302 to the canonical address, or render), then the page
 * loads from the row that lookup already fetched. A `/:slug` with no album hit
 * is looked up as a client homepage (T6.40e) before it becomes the 404.
 */
export async function galleryLoader(
  { request, context }: Args,
  target: GalleryTarget,
  env: RouteEnv,
) {
  const headers = baseHeaders(request);
  const res = await resolveGallery(env, target);
  if (res.kind === "redirect")
    return redirect(res.path + new URL(request.url).search, {
      status: 302,
      headers,
    });
  if (!res.hit && target.client === undefined) {
    const page = await loadClientPage(
      env,
      target.album,
      parsePageParam(new URL(request.url).searchParams.getAll(PAGE_PARAM)),
    );
    if (page)
      return data({ ...page, origin: publicOrigin(env, request) }, { headers });
  }
  const result = await loadGallery(request, target.album, env, {
    gallery: res.hit?.gallery,
  });
  // Fill R2 for the next photos in the background (bounded, best effort).
  if (result.data.state === "open")
    context
      .get(executionContext)
      .waitUntil(
        warmGalleryOnOpen(env, getDrive(env), target.album).catch(() => {}),
      );
  if (result.setCookie) headers.append("Set-Cookie", result.setCookie);
  const clientSlug =
    result.data.state === "unavailable" ? null : res.hit?.clientSlug;
  return data(
    {
      ...result.data,
      origin: publicOrigin(env, request),
      ...(clientSlug ? { clientSlug } : {}),
    },
    { status: result.status, headers },
  );
}

/** PIN POST: stays on the URL that rendered the form, 303s to the canonical one. */
export async function galleryAction(
  { request }: Pick<Args, "request">,
  target: GalleryTarget,
  env: RouteEnv,
) {
  const headers = baseHeaders(request);
  const result = await unlockGallery(request, target.album, env, target.client);
  if (result.status === 303) {
    if (result.setCookie) headers.append("Set-Cookie", result.setCookie);
    return redirect(result.location, { status: 303, headers });
  }
  const lang = getLang(request);
  const t = makeT(lang, lang === "en" ? enPublic : esPublic);
  const error =
    result.status === 429
      ? t("pin.tooManyAttempts")
      : result.status === 403
        ? t("pin.forbidden")
        : result.status === 404
          ? t("unavailable.message")
          : t("pin.wrong");
  return data({ error }, { status: result.status, headers });
}

/** The routes' `headers` export: security headers plus every Set-Cookie. */
export function galleryHeaders({
  loaderHeaders,
  actionHeaders,
}: {
  loaderHeaders: Headers;
  actionHeaders: Headers;
}) {
  const h = new Headers(SECURITY_HEADERS);
  for (const src of [loaderHeaders, actionHeaders]) {
    for (const cookie of src.getSetCookie()) h.append("Set-Cookie", cookie);
  }
  return h;
}
