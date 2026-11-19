import { env } from "cloudflare:workers";
import { requireAdmin } from "../lib/server/auth";
import { executionContext } from "../lib/server/context";
import { getDrive } from "../lib/server/drive-factory";
import { IMMUTABLE_CACHE_CONTROL, serveImage } from "../lib/server/images";
import type { ImageDeps } from "../lib/server/images";
import type { Route } from "./+types/admin.img.$photoId.$variant";

/**
 * Admin-only thumbnails: GET /admin/img/:photoId/:variant (thumb | view-sm).
 * Same R2 read-through cache as /img, but any gallery state is visible
 * (drafts included). Never exposes Drive ids or R2 keys.
 */
export async function serveAdminImage(
  request: Request,
  params: { photoId?: string; variant?: string },
  e: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
  deps: ImageDeps,
): Promise<Response> {
  await requireAdmin(request, e);
  const res = await serveImage(request, params, e, ctx, deps, { admin: true });
  return adminImageResponse(res);
}

/**
 * Admin header policy: `private, no-store` always, except an image answer
 * (200/304) whose `?v=` matched the admin token (`serveImage` marks it
 * immutable): that one may stay in the admin's own browser cache, never in a
 * shared one (`private`). Errors and redirects are never cacheable.
 */
export function adminImageResponse(res: Response): Response {
  const out = new Response(res.body, res);
  const keep =
    (res.status === 200 || res.status === 304) &&
    res.headers.get("Cache-Control") === IMMUTABLE_CACHE_CONTROL;
  out.headers.set(
    "Cache-Control",
    keep ? IMMUTABLE_CACHE_CONTROL : "private, no-store",
  );
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  return out;
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  return serveAdminImage(request, params, env, context.get(executionContext), {
    drive: getDrive(env),
  });
}
