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
import { requestT } from "../i18n/dictionaries";
import type { TFunction } from "../i18n/t";
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
  t: TFunction,
): Promise<SetupActionResult> {
  const id = parseDriveFolderId(input);
  if (!id) return fail("root", t("admin.msg.folderUnrecognized"));
  let meta;
  try {
    meta = await drive.getMeta(id);
  } catch (err) {
    if (err instanceof DriveError && (err.status === 404 || err.status === 403))
      return fail("root", t("admin.msg.folderNotFound"));
    console.error(
      "root folder check failed",
      err instanceof Error ? err.name : "error",
    );
    return fail("root", t("admin.msg.driveError"));
  }
  if (meta.trashed) return fail("root", t("admin.msg.folderTrashed"));
  if (meta.mimeType !== FOLDER_MIME)
    return fail("root", t("admin.msg.notFolder"));
  const current = await getSetting(e, SETTINGS_KEYS.driveRootId);
  if (current && current !== id && !confirmed)
    return fail("root", t("admin.msg.rootChangeConfirm"));
  await putSetting(e, SETTINGS_KEYS.driveRootId, id);
  if (current !== id) await deleteSetting(e, SETTINGS_KEYS.driveChangesToken);
  await putSetting(e, SETTINGS_KEYS.driveRootName, meta.name);
  return { intent: "root", ok: true, message: t("admin.msg.rootSaved") };
}

async function syncNow(
  e: Env,
  drive: DriveClient,
  t: TFunction,
): Promise<SetupActionResult> {
  const last = Date.parse(
    (await getSetting(e, SETTINGS_KEYS.syncLastOk)) ?? "",
  );
  if (Number.isFinite(last) && Date.now() - last < 30_000)
    return fail("sync", t("admin.msg.syncedRecently"));
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
    return fail("sync", t("admin.msg.syncFailed"));
  }
}

export async function setupAction(
  request: Request,
  e: Env,
  drive?: DriveClient,
): Promise<SetupActionResult> {
  await adminAction(request, e);
  const t = requestT(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  switch (intent) {
    case "disconnect":
      await disconnectGoogle(e);
      return { intent, ok: true, message: t("admin.msg.driveDisconnected") };
    case "root":
      return saveRoot(
        e,
        drive ?? getDrive(e),
        String(form.get("folder") ?? ""),
        form.get("confirm") === "1",
        t,
      );
    case "sync":
      return syncNow(e, drive ?? getDrive(e), t);
    case "studio": {
      const name = validStudioName(String(form.get("studioName") ?? ""));
      if (!name) return fail("studio", t("admin.msg.nameLength"));
      await putSetting(e, SETTINGS_KEYS.studioName, name);
      return { intent, ok: true, message: t("admin.msg.nameSaved") };
    }
    default:
      return fail(intent, t("admin.msg.unknownAction"));
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
