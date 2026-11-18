import { env } from "cloudflare:workers";
import { serveLogo } from "../lib/server/logo";
import type { Route } from "./+types/brand.logo.$variant";

/** Resource route: GET /brand/logo/:variant (the configured studio logo). */
export async function loader({ request, params }: Route.LoaderArgs) {
  return serveLogo(request, params.variant, env);
}
