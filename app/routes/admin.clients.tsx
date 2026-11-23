import { env } from "cloudflare:workers";

import { ClientList } from "../components/admin/clients/ClientList";
import { metaT, type MetaMatches } from "../i18n/meta";
import { adminHeaders } from "../lib/server/admin";
import {
  clientsListData,
  createClientAction,
} from "../lib/server/admin-clients";
import type { Route } from "./+types/admin.clients";

export const headers = () => adminHeaders();

export const meta = ({ matches }: MetaMatches) => [
  { title: metaT(matches)("admin.meta.clients") },
];

export async function loader({ request }: Route.LoaderArgs) {
  return clientsListData(request, env);
}

export async function action({ request }: Route.ActionArgs) {
  return createClientAction(request, env);
}

export default function AdminClients({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <ClientList
      clients={loaderData.clients}
      message={loaderData.message}
      actionData={actionData}
    />
  );
}
