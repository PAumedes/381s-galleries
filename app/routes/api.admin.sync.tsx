import type { RouterContextProvider } from "react-router";
import { env } from "cloudflare:workers";

import { adminAction } from "../lib/server/admin";
import { executionContext } from "../lib/server/context";
import { requireAdmin } from "../lib/server/auth";
import { getDrive } from "../lib/server/drive-factory";
import type { DriveClient } from "../lib/server/drive-types";
import { runRecordedSync, SyncBudgetError } from "../lib/server/sync";
import { methodNotAllowed } from "../lib/server/http";
import { scheduleWarmAfterSync } from "../lib/server/warm-after-sync";

/** POST /api/admin/sync: forced sync, returns the SyncResult (no Drive ids). */
export async function handleSync(
  request: Request,
  e: Env,
  drive?: DriveClient,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  await requireAdmin(request, e);
  if (request.method !== "POST")
    return methodNotAllowed("POST", "Method Not Allowed");
  // CSRF: the Access cookie is sent on cross-site requests, so refuse them.
  try {
    await adminAction(request, e);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
  try {
    const d = drive ?? getDrive(e);
    const result = await runRecordedSync(e, { drive: d, force: true });
    // New/changed photos: warm R2 in the background if the sync left budget.
    scheduleWarmAfterSync(e, { ctx, drive: d }, result);
    return Response.json(result);
  } catch (err) {
    console.error(
      "admin sync failed",
      err instanceof Error ? err.name : "error",
    );
    return Response.json(
      {
        error:
          err instanceof SyncBudgetError ? "budget_exceeded" : "sync_failed",
      },
      { status: 500 },
    );
  }
}

type Args = { request: Request; context: RouterContextProvider };

export async function loader({ request, context }: Args) {
  return handleSync(request, env, undefined, context.get(executionContext));
}

export async function action({ request, context }: Args) {
  return handleSync(request, env, undefined, context.get(executionContext));
}
