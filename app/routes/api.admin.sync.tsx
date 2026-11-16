import { env } from "cloudflare:workers";

import { requireAdmin } from "../lib/server/auth";
import { getDrive } from "../lib/server/drive-factory";
import type { DriveClient } from "../lib/server/drive-types";
import { runSync, SyncBudgetError } from "../lib/server/sync";

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
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  if (
    site === "cross-site" ||
    site === "same-site" ||
    (origin !== null && origin !== new URL(request.url).origin)
  )
    return new Response("Forbidden", { status: 403 });
  try {
    const result = await runSync(e, {
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
