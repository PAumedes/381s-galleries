import { env } from "cloudflare:workers";

import { handleConnect } from "../lib/server/google-auth";
import type { Route } from "./+types/admin.google.connect";

export async function loader({ request }: Route.LoaderArgs) {
  return handleConnect(request, env);
}
