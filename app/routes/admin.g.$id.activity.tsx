import { env } from "cloudflare:workers";

import { ActivityView } from "../components/admin/ActivityView";
import { adminHeaders } from "../lib/server/admin";
import { loadActivity } from "../lib/server/admin-activity";
import { requireAdmin } from "../lib/server/auth";
import type { Route } from "./+types/admin.g.$id.activity";

export const headers = () => adminHeaders();

export const meta = () => [{ title: "Actividad" }];

/** Admin-guarded loader body: 401 for non-admins, 404 for an unknown gallery. */
export async function activityData(request: Request, e: Env, id: string) {
  await requireAdmin(request, e);
  const data = await loadActivity(e, id, new URL(request.url).searchParams);
  if (!data) throw new Response("Not found", { status: 404 });
  return data;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return activityData(request, env, params.id);
}

export default function AdminActivity({ loaderData }: Route.ComponentProps) {
  return <ActivityView data={loaderData} />;
}
