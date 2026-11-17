import { env } from "cloudflare:workers";
import { requireAdmin } from "../lib/server/auth";
import { executionContext } from "../lib/server/context";
import { getDrive } from "../lib/server/drive-factory";
import { serveImage } from "../lib/server/images";
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
  const out = new Response(res.body, res);
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  return out;
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  return serveAdminImage(request, params, env, context.get(executionContext), {
    drive: getDrive(env),
  });
}
