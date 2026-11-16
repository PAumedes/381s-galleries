import { env } from "cloudflare:workers";

import { handleCallback } from "../lib/server/google-auth";
import type { Route } from "./+types/admin.google.callback";

export async function loader({ request }: Route.LoaderArgs) {
  return handleCallback(request, env);
}
