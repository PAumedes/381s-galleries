import { env } from "cloudflare:workers";
import { data } from "react-router";

import { PrivacyPage } from "../components/PrivacyPage";
import { getLang, langCookie } from "../i18n/lang";
import type { Route } from "./+types/privacy";

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
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
