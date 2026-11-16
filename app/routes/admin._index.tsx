import { env } from "cloudflare:workers";

import { requireAdmin } from "../lib/server/auth";
import { isGoogleConnected } from "../lib/server/google-auth";
import type { Route } from "./+types/admin._index";

const MESSAGES: Record<string, string> = {
  connected: "Google Drive conectado correctamente.",
  denied: "Se canceló la autorización de Google.",
  state: "La sesión de autorización expiró. Intentá de nuevo.",
  exchange: "No se pudo completar la conexión con Google.",
  no_refresh_token:
    "Google no entregó un token de actualización. Revocá el acceso a la app y reconectá.",
  scope: "Google otorgó permisos distintos a los esperados.",
};

export async function loader({ request }: Route.LoaderArgs) {
  return adminIndexData(request, env);
}

export async function adminIndexData(
  request: Request,
  env: Parameters<typeof requireAdmin>[1] &
    Parameters<typeof isGoogleConnected>[0],
) {
  await requireAdmin(request, env);
  const q = new URL(request.url).searchParams;
  const flag = q.get("google");
  const reason = q.get("reason");
  const message =
    flag === "connected"
      ? MESSAGES.connected
      : flag === "error"
        ? reason !== null && Object.hasOwn(MESSAGES, reason)
          ? MESSAGES[reason]
          : "Error al conectar con Google."
        : null;
  return { connected: await isGoogleConnected(env), message };
}

export default function AdminIndex({ loaderData }: Route.ComponentProps) {
  return (
    <main className="p-8">
      <h1 className="text-xl">Administración</h1>
      {loaderData.message && <p role="status">{loaderData.message}</p>}
      <p>Google Drive: {loaderData.connected ? "conectado" : "no conectado"}</p>
      <a href="/admin/google/connect" className="underline">
        Conectar
      </a>
    </main>
  );
}
