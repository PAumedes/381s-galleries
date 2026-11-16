import { env } from "cloudflare:workers";

import {
  handleListFavorites,
  handleSetFavorite,
} from "../lib/server/favorites";
import type { Route } from "./+types/api.g.$slug.favorites";

export async function loader({ request, params }: Route.LoaderArgs) {
  return handleListFavorites(request, params.slug, env);
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  return handleSetFavorite(request, params.slug, env);
}
