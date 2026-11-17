import { env } from "cloudflare:workers";
import { getDrive } from "../lib/server/drive-factory";
import { serveDownload } from "../lib/server/downloads";
import type { Route } from "./+types/dl.$token";

/** Resource route: GET/HEAD /dl/:token (loader only; HEAD runs the loader). */
export async function loader({ request, params }: Route.LoaderArgs) {
  return serveDownload(request, params.token, env, { drive: getDrive(env) });
}
