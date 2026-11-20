import { env } from "cloudflare:workers";

import { handleVisitor } from "../lib/server/favorites";
import type { Route } from "./+types/api.g.$slug.visitor";
import { methodNotAllowed } from "../lib/server/http";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }
  return handleVisitor(request, params.slug, env);
}
