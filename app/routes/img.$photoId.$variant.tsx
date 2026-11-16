import { env } from "cloudflare:workers";
import { executionContext } from "../lib/server/context";
import { getDrive } from "../lib/server/drive-factory";
import { serveImage } from "../lib/server/images";
import type { Route } from "./+types/img.$photoId.$variant";

/** Resource route: GET /img/:photoId/:variant (loader only). */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  return serveImage(request, params, env, context.get(executionContext), {
    drive: getDrive(env),
  });
}
