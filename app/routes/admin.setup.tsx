import { env } from "cloudflare:workers";
import { useActionData } from "react-router";

import { SetupView } from "../components/admin/SetupView";
import {
  adminAction,
  adminHeaders,
  getStudioName,
  parseDriveFolderId,
  validStudioName,
} from "../lib/server/admin";
import { requireAdmin } from "../lib/server/auth";
import { getDrive } from "../lib/server/drive-factory";
import { DriveError, FOLDER_MIME } from "../lib/server/drive-types";
import type { DriveClient } from "../lib/server/drive-types";
import { disconnectGoogle, isGoogleConnected } from "../lib/server/google-auth";
import {
  deleteSetting,
  getSetting,
  putSetting,
  SETTINGS_KEYS,
} from "../lib/server/settings";
import { runRecordedSync, SyncBudgetError } from "../lib/server/sync";
import type { SyncResult } from "../lib/server/sync";
import { nowIso } from "../db";
import { warmProgress } from "../lib/server/warm";
import type { LastError } from "./admin";
import type { Route } from "./+types/admin.setup";

export const headers = () => adminHeaders();

export async function setupData(request: Request, e: Env) {
  await requireAdmin(request, e);
  const raw = await getSetting(e, SETTINGS_KEYS.syncLastError);
  let lastError: LastError | null = null;
  try {
    const v = raw ? (JSON.parse(raw) as Partial<LastError>) : null;
    if (typeof v?.at === "string" && typeof v.message === "string")
      lastError = { at: v.at, message: v.message };
  } catch {
    /* ignore corrupt value */
  }
  const mock = e.DRIVE_MODE === "mock";
  return {
    mock,
    connected: await isGoogleConnected(e),
    rootName: (await getSetting(e, SETTINGS_KEYS.driveRootName)) ?? null,
    studioName: await getStudioName(e, request),
    lastSyncAt: (await getSetting(e, SETTINGS_KEYS.syncLastOk)) ?? null,
    cacheWarm: await warmProgress(e),
    lastError,
  };
}

export interface SetupActionResult {
  intent: string;
  ok: boolean;
  error?: string;
  message?: string;
  result?: SyncResult;
}

const fail = (intent: string, error: string): SetupActionResult => ({
  intent,
  ok: false,
  error,
});

async function saveRoot(
  e: Env,
  drive: DriveClient,
  input: string,
  confirmed: boolean,
): Promise<SetupActionResult> {
  const id = parseDriveFolderId(input);
  if (!id)
    return fail(
      "root",
      "No reconocimos ese enlace. Pegá el enlace de la carpeta de Drive o su ID.",
    );
  let meta;
  try {
    meta = await drive.getMeta(id);
  } catch (err) {
    if (err instanceof DriveError && (err.status === 404 || err.status === 403))
      return fail(
        "root",
        "No se encontró la carpeta o la cuenta conectada no tiene acceso.",
      );
    console.error(
      "root folder check failed",
      err instanceof Error ? err.name : "error",
    );
    return fail("root", "No se pudo consultar Google Drive. Intentá de nuevo.");
  }
  if (meta.trashed)
    return fail("root", "Esa carpeta está en la papelera de Drive.");
  if (meta.mimeType !== FOLDER_MIME)
    return fail("root", "El enlace no corresponde a una carpeta.");
  const current = await getSetting(e, SETTINGS_KEYS.driveRootId);
  if (current && current !== id && !confirmed)
    return fail(
      "root",
      "Al cambiar la carpeta raíz, las galerías que no estén en la nueva carpeta se archivarán después de 1 hora. Confirmá el cambio para continuar.",
    );
  await putSetting(e, SETTINGS_KEYS.driveRootId, id);
  if (current !== id) await deleteSetting(e, SETTINGS_KEYS.driveChangesToken);
  await putSetting(e, SETTINGS_KEYS.driveRootName, meta.name);
  return { intent: "root", ok: true, message: "Carpeta raíz guardada." };
}

async function syncNow(e: Env, drive: DriveClient): Promise<SetupActionResult> {
  const last = Date.parse(
    (await getSetting(e, SETTINGS_KEYS.syncLastOk)) ?? "",
  );
  if (Number.isFinite(last) && Date.now() - last < 30_000)
    return fail("sync", "Se sincronizó hace instantes");
  try {
    const result = await runRecordedSync(e, { drive, force: true });
    return { intent: "sync", ok: true, result };
  } catch (err) {
    console.error(
      "admin sync failed",
      err instanceof Error ? err.name : "error",
    );
    const message =
      err instanceof SyncBudgetError ? "budget exceeded" : "sync failed";
    await putSetting(
      e,
      SETTINGS_KEYS.syncLastError,
      JSON.stringify({ at: nowIso(), message }),
    ).catch(() => {});
    return fail(
      "sync",
      "No se pudo sincronizar. Revisá la conexión e intentá de nuevo.",
    );
  }
}

export async function setupAction(
  request: Request,
  e: Env,
  drive?: DriveClient,
): Promise<SetupActionResult> {
  await adminAction(request, e);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  switch (intent) {
    case "disconnect":
      await disconnectGoogle(e);
      return { intent, ok: true, message: "Google Drive desconectado." };
    case "root":
      return saveRoot(
        e,
        drive ?? getDrive(e),
        String(form.get("folder") ?? ""),
        form.get("confirm") === "1",
      );
    case "sync":
      return syncNow(e, drive ?? getDrive(e));
    case "studio": {
      const name = validStudioName(String(form.get("studioName") ?? ""));
      if (!name)
        return fail("studio", "El nombre debe tener entre 1 y 60 caracteres.");
      await putSetting(e, SETTINGS_KEYS.studioName, name);
      return { intent, ok: true, message: "Nombre guardado." };
    }
    default:
      return fail(intent, "Acción desconocida.");
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  return setupData(request, env);
}

export async function action({ request }: Route.ActionArgs) {
  return setupAction(request, env);
}

export default function AdminSetup({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  return <SetupView data={loaderData} actionData={actionData} />;
}
