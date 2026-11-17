import { env } from "cloudflare:workers";

import { handleManifest } from "../lib/server/manifest";
import type { Route } from "./+types/api.g.$slug.manifest";

export async function loader({ request, params }: Route.LoaderArgs) {
  return handleManifest(request, params.slug, env);
}
