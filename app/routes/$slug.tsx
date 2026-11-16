import { env } from "cloudflare:workers";
import { data, redirect } from "react-router";

import { GalleryView } from "../components/GalleryView";
import { PinScreen } from "../components/PinScreen";
import { UnavailableScreen } from "../components/UnavailableScreen";
import { en } from "../i18n/en";
import { es } from "../i18n/es";
import { getLang, langCookie } from "../i18n/lang";
import { makeT } from "../i18n/t";
import { loadGallery, unlockGallery } from "../lib/server/gallery";
import type { Route } from "./+types/$slug";

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "same-origin",
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

export async function loader({ request, params }: Route.LoaderArgs) {
  const result = await loadGallery(request, params.slug, env);
  const headers = baseHeaders(request);
  if (result.setCookie) headers.append("Set-Cookie", result.setCookie);
  return data(result.data, { status: result.status, headers });
}

export async function action({ request, params }: Route.ActionArgs) {
  const headers = baseHeaders(request);
  const result = await unlockGallery(request, params.slug, env);
  if (result.status === 303) {
    if (result.setCookie) headers.append("Set-Cookie", result.setCookie);
    return redirect(result.location, { status: 303, headers });
  }
  const lang = getLang(request);
  const t = makeT(lang, lang === "en" ? en : es);
  const error =
    result.status === 429
      ? t("pin.tooManyAttempts")
      : result.status === 403
        ? t("pin.error.forbidden")
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

export function meta({ loaderData: d }: Route.MetaArgs) {
  const title =
    d && d.state !== "unavailable"
      ? `${d.state === "open" ? d.gallery.title : d.title} · 381 Studios`
      : "381 Studios";
  return [
    { title },
    { name: "robots", content: "noindex,nofollow" },
    { property: "og:title", content: title },
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
      return <PinScreen title={loaderData.title} error={actionData?.error} />;
    default:
      return <UnavailableScreen />;
  }
}
