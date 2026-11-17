import { env } from "cloudflare:workers";

import { getAdminLang } from "../i18n/lang";
import { activityCsv } from "../lib/server/admin-activity";
import { requireAdmin } from "../lib/server/auth";
import type { Route } from "./+types/admin.g.$id.activity-csv";

/** `/admin/g/:id/activity.csv` resource route (no component). */
export async function csvResponse(request: Request, e: Env, id: string) {
  await requireAdmin(request, e);
  const res = await activityCsv(e, id, getAdminLang(request));
  if (!res) throw new Response("Not found", { status: 404 });
  return res;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return csvResponse(request, env, params.id);
}
