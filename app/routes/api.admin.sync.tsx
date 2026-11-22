import type { RouterContextProvider } from "react-router";
import { env } from "cloudflare:workers";

import { adminAction } from "../lib/server/admin";
import { executionContext } from "../lib/server/context";
import { meterD1 } from "../lib/server/d1-meter";
import { requireAdmin } from "../lib/server/auth";
import { getDrive } from "../lib/server/drive-factory";
import type { DriveClient } from "../lib/server/drive-types";
import { SyncBudgetError } from "../lib/server/sync";
import { syncThenWarm } from "../lib/server/sync-and-warm";
import { methodNotAllowed } from "../lib/server/http";

/** POST /api/admin/sync: forced sync, returns the SyncResult (no Drive ids). */
export async function handleSync(
  request: Request,
  base: Env,
  drive?: DriveClient,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  // Counts this invocation's D1 queries (admin check, sync) so the background
  // warm only gets what is left of the Free 50.
  const meter = meterD1(base);
  const e = meter.env;
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
    const result = await syncThenWarm(meter, d, ctx);
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
