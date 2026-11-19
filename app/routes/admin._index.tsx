import { env } from "cloudflare:workers";

import { GalleryList } from "../components/admin/GalleryList";
import { parseFilter } from "../lib/admin-gallery";
import { requestT } from "../i18n/dictionaries";
import { useT } from "../i18n/use-t";
import type { MessageKey } from "../i18n/t";
import { adminHeaders } from "../lib/server/admin";
import { countGalleries, listGalleries } from "../lib/server/admin-galleries";
import { requireAdmin } from "../lib/server/auth";
import { isGoogleConnected } from "../lib/server/google-auth";
import { getSetting, SETTINGS_KEYS } from "../lib/server/settings";
import type { Route } from "./+types/admin._index";

/** `?reason=` codes from the Google callback -> message keys. */
const REASON_KEYS: Record<string, MessageKey> = {
  denied: "admin.google.denied",
  state: "admin.google.state",
  exchange: "admin.google.exchange",
  no_refresh_token: "admin.google.no_refresh_token",
  scope: "admin.google.scope",
};

export async function loader({ request }: Route.LoaderArgs) {
  return adminIndexData(request, env);
}

export async function adminIndexData(request: Request, env: Env) {
  await requireAdmin(request, env);
  const q = new URL(request.url).searchParams;
  const t = requestT(request);
  const flag = q.get("google");
  const reason = q.get("reason");
  const message =
    q.get("deleted") === "1"
      ? t("admin.msg.galleryDeleted")
      : flag === "connected"
        ? t("admin.google.connected")
        : flag === "error"
          ? t(
              reason !== null && Object.hasOwn(REASON_KEYS, reason)
                ? REASON_KEYS[reason]!
                : "admin.google.error",
            )
          : null;
  const filter = parseFilter(q.get("estado"));
  const search = (q.get("q") ?? "").trim().slice(0, 100);
  return {
    connected: await isGoogleConnected(env),
    message,
    filter,
    q: search,
    galleries: await listGalleries(env, filter, search),
    total: await countGalleries(env),
    rootName: (await getSetting(env, SETTINGS_KEYS.driveRootName)) ?? null,
  };
}

export const headers = () => adminHeaders();

export default function AdminIndex({ loaderData }: Route.ComponentProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title text-ink">{t("admin.nav.galleries")}</h1>
      {loaderData.message && (
        <p role="status" className="border-ink border p-3 text-small">
          {loaderData.message}
        </p>
      )}
      <GalleryList
        galleries={loaderData.galleries}
        filter={loaderData.filter}
        q={loaderData.q}
        total={loaderData.total}
        rootName={loaderData.rootName}
      />
    </div>
  );
}
