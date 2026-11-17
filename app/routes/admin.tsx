import { env } from "cloudflare:workers";
import { Outlet } from "react-router";

import { metaT, type MetaMatches } from "../i18n/meta";

import { AdminShell } from "../components/admin/AdminShell";
import { adminHeaders } from "../lib/server/admin";
import { requireAdmin } from "../lib/server/auth";
import { isGoogleConnected } from "../lib/server/google-auth";
import { getSetting, SETTINGS_KEYS } from "../lib/server/settings";
import type { Route } from "./+types/admin";

export const headers = () => adminHeaders();
export const meta = ({ matches }: MetaMatches) => [
  { title: metaT(matches)("admin.meta.admin") },
  { name: "robots", content: "noindex, nofollow" },
];

export interface LastError {
  at: string;
  message: string;
}

function parseLastError(raw: string | undefined): LastError | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LastError> | null;
    if (typeof v?.at === "string" && typeof v.message === "string")
      return { at: v.at, message: v.message };
  } catch {
    /* corrupt value: treat as none */
  }
  return null;
}

export async function adminLayoutData(
  request: Request,
  e: Pick<
    Env,
    | "DB"
    | "DRIVE_MODE"
    | "ADMIN_EMAIL"
    | "TOKEN_KEY"
    | "GOOGLE_CLIENT_ID"
    | "GOOGLE_CLIENT_SECRET"
  > &
    Partial<Pick<Env, "ALLOW_DEV_ADMIN" | "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD">>,
) {
  await requireAdmin(request, e);
  const mock = e.DRIVE_MODE === "mock";
  return {
    mock,
    connected: await isGoogleConnected(e),
    lastSyncAt: (await getSetting(e, SETTINGS_KEYS.syncLastOk)) ?? null,
    lastError: parseLastError(await getSetting(e, SETTINGS_KEYS.syncLastError)),
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  return adminLayoutData(request, env);
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <AdminShell status={loaderData}>
      <Outlet />
    </AdminShell>
  );
}
