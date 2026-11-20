import { env } from "cloudflare:workers";
import { handleBulk } from "../lib/server/downloads";
import type { Route } from "./+types/api.g.$slug.bulk";
import { methodNotAllowed } from "../lib/server/http";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }
  return handleBulk(request, params.slug, env);
}
