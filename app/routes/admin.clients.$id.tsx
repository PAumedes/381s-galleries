import { env } from "cloudflare:workers";

import { ClientEditView } from "../components/admin/clients/ClientEditView";
import { metaT, type MetaMatches } from "../i18n/meta";
import { adminHeaders } from "../lib/server/admin";
import { clientAction, clientEditData } from "../lib/server/admin-clients";
import type { Route } from "./+types/admin.clients.$id";

export const headers = () => adminHeaders();

export const meta = ({ matches }: MetaMatches) => [
  { title: metaT(matches)("admin.meta.clientEdit") },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  return clientEditData(request, env, params.id);
}

export async function action({ request, params }: Route.ActionArgs) {
  return clientAction(request, env, params.id);
}

export default function AdminClientEdit({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <ClientEditView
      client={loaderData.client}
      albums={loaderData.albums}
      publicPage={loaderData.publicPage}
      actionData={actionData}
    />
  );
}
