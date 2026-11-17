import { env } from "cloudflare:workers";

import { getAdminLang } from "../i18n/lang";
import { favoritesTxt } from "../lib/server/admin-activity";
import { requireAdmin } from "../lib/server/auth";
import type { Route } from "./+types/admin.g.$id.favorites-txt";

/** `/admin/g/:id/favorites.txt[?visitor=<id>]` resource route (no component). */
export async function txtResponse(request: Request, e: Env, id: string) {
  await requireAdmin(request, e);
  const visitor = new URL(request.url).searchParams.get("visitor");
  const res = await favoritesTxt(e, id, visitor || null, getAdminLang(request));
  if (!res) throw new Response("Not found", { status: 404 });
  return res;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return txtResponse(request, env, params.id);
}
