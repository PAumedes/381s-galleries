import { env } from "cloudflare:workers";
import { data } from "react-router";

import { PrivacyPage } from "../components/PrivacyPage";
import { getLang, langCookie } from "../i18n/lang";
import type { Route } from "./+types/privacy";
import { NOSNIFF, PRIVATE_NO_STORE } from "../lib/server/http";

const SECURITY_HEADERS = {
  "Cache-Control": PRIVATE_NO_STORE,
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  ...NOSNIFF,
};

export function meta() {
  return [{ title: "Privacidad / Privacy" }];
}

export function loader({ request }: Route.LoaderArgs) {
  const headers = new Headers(SECURITY_HEADERS);
  if (new URL(request.url).searchParams.has("lang"))
    headers.append("Set-Cookie", langCookie(getLang(request)));
  return data(
    { contactEmail: env.PUBLIC_CONTACT_EMAIL?.trim() || null },
    { headers },
  );
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  const h = new Headers(SECURITY_HEADERS);
  for (const c of loaderHeaders.getSetCookie()) h.append("Set-Cookie", c);
  return h;
}

export default function Privacy({ loaderData }: Route.ComponentProps) {
  return <PrivacyPage contactEmail={loaderData.contactEmail} />;
}
