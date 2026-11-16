import { env } from "cloudflare:workers";
import { handleDownloadTokens } from "../lib/server/downloads";
import type { Route } from "./+types/api.g.$slug.download-tokens";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  return handleDownloadTokens(request, params.slug, env);
}
