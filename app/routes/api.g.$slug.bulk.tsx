import { env } from "cloudflare:workers";
import { handleBulk } from "../lib/server/downloads";
import type { Route } from "./+types/api.g.$slug.bulk";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  return handleBulk(request, params.slug, env);
}
