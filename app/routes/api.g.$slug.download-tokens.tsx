import { env } from "cloudflare:workers";
import { handleDownloadTokens } from "../lib/server/downloads";
import type { Route } from "./+types/api.g.$slug.download-tokens";
import { methodNotAllowed } from "../lib/server/http";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }
  return handleDownloadTokens(request, params.slug, env);
}
