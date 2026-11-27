import { env } from "cloudflare:workers";

import { WizardView } from "../components/admin/wizard/WizardView";
import { metaT, type MetaMatches } from "../i18n/meta";
import { adminHeaders } from "../lib/server/admin";
import { wizardMetaTitle } from "../lib/wizard";
import { wizardAction, wizardData } from "../lib/server/admin-wizard";
import type { Route } from "./+types/admin.empezar";

export const headers = () => adminHeaders();

export const meta = ({
  matches,
  data,
}: MetaMatches & { data?: { step?: number } }) => [
  { title: wizardMetaTitle(metaT(matches), data?.step ?? 0) },
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
