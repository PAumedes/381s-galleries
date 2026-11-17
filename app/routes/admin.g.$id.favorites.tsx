import { env } from "cloudflare:workers";

import { FavoritesView } from "../components/admin/FavoritesView";
import { adminHeaders } from "../lib/server/admin";
import { loadFavoritesAdmin } from "../lib/server/admin-activity";
import { requireAdmin } from "../lib/server/auth";
import type { Route } from "./+types/admin.g.$id.favorites";

export const headers = () => adminHeaders();

export const meta = () => [{ title: "Favoritos" }];

/** Admin-guarded loader body: 401 for non-admins, 404 for an unknown gallery. */
export async function favoritesData(request: Request, e: Env, id: string) {
  await requireAdmin(request, e);
  const data = await loadFavoritesAdmin(e, id);
  if (!data) throw new Response("Not found", { status: 404 });
  return data;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return favoritesData(request, env, params.id);
}

export default function AdminFavorites({ loaderData }: Route.ComponentProps) {
  return <FavoritesView data={loaderData} />;
}
