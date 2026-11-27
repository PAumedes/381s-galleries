import { env } from "cloudflare:workers";

import { handleSetApproval } from "../lib/server/approvals";
import type { Route } from "./+types/api.g.$slug.approvals";
import { methodNotAllowed } from "../lib/server/http";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }
  return handleSetApproval(request, params.slug, env);
}
