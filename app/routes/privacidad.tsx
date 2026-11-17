import { redirect } from "react-router";

import type { Route } from "./+types/privacidad";

/** Legacy Spanish path: canonical page is /privacy (registered in Google). */
export function loader({ request }: Route.LoaderArgs) {
  const { search } = new URL(request.url);
  return redirect(`/privacy${search}`, 301);
}
