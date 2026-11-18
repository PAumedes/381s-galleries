import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { useLoaderData, useRouteLoaderData } from "react-router";

import { getDb, schema } from "../db";
import { CardView, type CardLang } from "../components/admin/CardView";
import { asAdminLang, getAdminLang } from "../i18n/lang";
import { metaT, type MetaMatches } from "../i18n/meta";
import { adminHeaders, getStudioName } from "../lib/server/admin";
import { requireAdmin } from "../lib/server/auth";
import { publicGalleryUrl } from "../lib/server/public-url";
import type { loader as rootLoader } from "../root";
import type { Route } from "./+types/admin.g.$id.card";

export const headers = () => adminHeaders();

export const meta = ({ matches }: MetaMatches) => [
  { title: metaT(matches)("admin.meta.card") },
  { name: "robots", content: "noindex, nofollow" },
];

/** Admin-guarded loader body: 401 non-admin, 404 unknown gallery. */
export async function cardData(request: Request, e: Env, id: string) {
  await requireAdmin(request, e);
  const url = new URL(request.url);
  const [g] = await getDb(e)
    .select({
      slug: schema.galleries.slug,
      title: schema.galleries.title,
      eventDate: schema.galleries.eventDate,
      pinHash: schema.galleries.pinHash,
    })
    .from(schema.galleries)
    .where(eq(schema.galleries.id, id));
  if (!g) throw new Response("Not found", { status: 404 });
  // An explicit ?lang= (es|en) wins; otherwise the admin language.
  const lang: CardLang =
    asAdminLang(url.searchParams.get("lang")) ?? getAdminLang(request);
  return {
    title: g.title,
    eventDate: g.eventDate,
    url: publicGalleryUrl(e, request, g.slug),
    hasPin: g.pinHash !== null,
    studioName: await getStudioName(e, request),
    lang,
  };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return cardData(request, env, params.id);
}

export default function AdminGalleryCard() {
  const logo = useRouteLoaderData<typeof rootLoader>("root")?.logo;
  return <CardView {...useLoaderData<typeof loader>()} logo={logo} />;
}
