import { env } from "cloudflare:workers";

import { WizardView } from "../components/admin/wizard/WizardView";
import { metaT, type MetaMatches } from "../i18n/meta";
import { adminHeaders } from "../lib/server/admin";
import { wizardAction, wizardData } from "../lib/server/admin-wizard";
import type { Route } from "./+types/admin.empezar";

export const headers = () => adminHeaders();

export const meta = ({ matches }: MetaMatches) => [
  { title: metaT(matches)("admin.meta.wizard") },
];

export async function loader({ request }: Route.LoaderArgs) {
  return wizardData(request, env);
}

export async function action({ request }: Route.ActionArgs) {
  return wizardAction(request, env);
}

export default function AdminWizard({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return <WizardView data={loaderData} actionData={actionData} />;
}
