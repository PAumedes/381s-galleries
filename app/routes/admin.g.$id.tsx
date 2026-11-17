import { env } from "cloudflare:workers";
import { useActionData } from "react-router";

import { GalleryEditView } from "../components/admin/GalleryEditView";
import { adminHeaders } from "../lib/server/admin";
import { galleryAction, loadGalleryEdit } from "../lib/server/admin-galleries";
import { requireAdmin } from "../lib/server/auth";
import type { Route } from "./+types/admin.g.$id";

export const headers = () => adminHeaders();

export const meta = () => [{ title: "Editar galería" }];

/** Admin-guarded loader body: 401 for non-admins, 404 for an unknown gallery. */
export async function editData(request: Request, e: Env, id: string) {
  await requireAdmin(request, e);
  const data = await loadGalleryEdit(e, id);
  if (!data) throw new Response("Not found", { status: 404 });
  return data;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return editData(request, env, params.id);
}

export async function action({ request, params }: Route.ActionArgs) {
  return galleryAction(request, env, params.id);
}

export default function AdminGalleryEdit({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  return <GalleryEditView data={loaderData} actionData={actionData} />;
}
