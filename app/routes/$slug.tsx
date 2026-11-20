import { env } from "cloudflare:workers";
import { data, redirect } from "react-router";

import { GalleryView } from "../components/GalleryView";
import { PinScreen } from "../components/PinScreen";
import { UnavailableScreen } from "../components/UnavailableScreen";
import { enPublic } from "../i18n/en.public";
import { esPublic } from "../i18n/es.public";
import { getLang, langCookie } from "../i18n/lang";
import { makeT } from "../i18n/t";
import { galleryMeta } from "../lib/og";
import { pwaMeta } from "../lib/pwa";
import { DEFAULT_STUDIO_NAME } from "../lib/default-studio-name";
import { executionContext } from "../lib/server/context";
import { getDrive } from "../lib/server/drive-factory";
import { loadGallery, unlockGallery } from "../lib/server/gallery";
import { warmGalleryOnOpen } from "../lib/server/gallery-warm";
import { publicOrigin } from "../lib/server/public-url";
import type { Route } from "./+types/$slug";
import { NOSNIFF, PRIVATE_NO_STORE } from "../lib/server/http";

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

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const result = await loadGallery(request, params.slug, env);
  // Fill R2 for the next photos in the background (bounded, best effort).
  if (result.data.state === "open")
    context
      .get(executionContext)
      .waitUntil(
        warmGalleryOnOpen(env, getDrive(env), params.slug).catch(() => {}),
      );
  const headers = baseHeaders(request);
  if (result.setCookie) headers.append("Set-Cookie", result.setCookie);
  return data(
    { ...result.data, origin: publicOrigin(env, request) },
    { status: result.status, headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const headers = baseHeaders(request);
  const result = await unlockGallery(request, params.slug, env);
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

export function headers({ loaderHeaders, actionHeaders }: Route.HeadersArgs) {
  const h = new Headers(SECURITY_HEADERS);
  for (const src of [loaderHeaders, actionHeaders]) {
    for (const cookie of src.getSetCookie()) h.append("Set-Cookie", cookie);
  }
  return h;
}

export function meta({ loaderData: d, matches }: Route.MetaArgs) {
  const root = matches.find((m) => m?.id === "root")?.loaderData as
    { studioName?: string; lang?: string } | undefined;
  const studio = root?.studioName ?? DEFAULT_STUDIO_NAME;
  return [
    ...galleryMeta(d, {
      studio,
      lang: root?.lang ?? "es",
      origin: d?.origin ?? "",
    }),
    ...pwaMeta(d, { studio }),
  ];
}

export default function GalleryPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  switch (loaderData.state) {
    case "open":
      return (
        <GalleryView gallery={loaderData.gallery} photos={loaderData.photos} />
      );
    case "locked":
      return (
        <PinScreen
          title={loaderData.title}
          palette={loaderData.palette}
          error={actionData?.error}
        />
      );
    default:
      return <UnavailableScreen />;
  }
}
