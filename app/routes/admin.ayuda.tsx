import { env } from "cloudflare:workers";

import { HelpView } from "../components/admin/help/HelpView";
import { metaT, type MetaMatches } from "../i18n/meta";
import { adminHeaders } from "../lib/server/admin";
import { helpData } from "../lib/server/admin-help";
import type { Route } from "./+types/admin.ayuda";

export const headers = () => adminHeaders();

export const meta = ({ matches }: MetaMatches) => [
  { title: metaT(matches)("admin.meta.help") },
];

export async function loader({ request }: Route.LoaderArgs) {
  return helpData(request, env);
}

export default function AdminHelp() {
  return <HelpView />;
}
