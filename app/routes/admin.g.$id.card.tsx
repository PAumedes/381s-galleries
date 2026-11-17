import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { useLoaderData } from "react-router";

import { getDb, schema } from "../db";
import { CardView, type CardLang } from "../components/admin/CardView";
import { adminHeaders, getStudioName } from "../lib/server/admin";
import { requireAdmin } from "../lib/server/auth";
import { publicGalleryUrl } from "../lib/server/public-url";
import type { Route } from "./+types/admin.g.$id.card";

export const headers = () => adminHeaders();

export const meta = () => [
  { title: "Tarjeta" },
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
  const lang: CardLang = url.searchParams.get("lang") === "en" ? "en" : "es";
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
  return <CardView {...useLoaderData<typeof loader>()} />;
}
