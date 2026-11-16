import { env } from "cloudflare:workers";

import { handleVisitor } from "../lib/server/favorites";
import type { Route } from "./+types/api.g.$slug.visitor";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  return handleVisitor(request, params.slug, env);
}
