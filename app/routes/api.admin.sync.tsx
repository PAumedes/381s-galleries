import { env } from "cloudflare:workers";

import { adminAction } from "../lib/server/admin";
import { requireAdmin } from "../lib/server/auth";
import { getDrive } from "../lib/server/drive-factory";
import type { DriveClient } from "../lib/server/drive-types";
import { runRecordedSync, SyncBudgetError } from "../lib/server/sync";

/** POST /api/admin/sync: forced sync, returns the SyncResult (no Drive ids). */
export async function handleSync(
  request: Request,
  e: Env,
  drive?: DriveClient,
): Promise<Response> {
  await requireAdmin(request, e);
  if (request.method !== "POST")
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  // CSRF: the Access cookie is sent on cross-site requests, so refuse them.
  try {
    await adminAction(request, e);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
  try {
    const result = await runRecordedSync(e, {
      drive: drive ?? getDrive(e),
      force: true,
    });
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

export async function loader({ request }: { request: Request }) {
  return handleSync(request, env);
}

export async function action({ request }: { request: Request }) {
  return handleSync(request, env);
}
