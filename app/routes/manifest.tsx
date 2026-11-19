import { env } from "cloudflare:workers";

import { handleGenericManifest } from "../lib/server/manifest";
import type { Route } from "./+types/manifest";

export async function loader({ request }: Route.LoaderArgs) {
  return handleGenericManifest(request, env);
}
