import { env } from "cloudflare:workers";

import { GalleryRoutePage } from "../components/GalleryRoutePage";
import { galleryRouteMeta } from "../lib/gallery-route-meta";
import {
  galleryAction,
  galleryHeaders,
  galleryLoader,
} from "../lib/server/gallery-route";
import type { Route } from "./+types/$client.$album";

// An album under its client: same loader/action/page as `/:slug`.
export const loader = (args: Route.LoaderArgs) =>
  galleryLoader(args, args.params, env);

export const action = (args: Route.ActionArgs) =>
  galleryAction(args, args.params, env);

export const headers = (args: Route.HeadersArgs) => galleryHeaders(args);

export const meta = (args: Route.MetaArgs) => galleryRouteMeta(args);

export default function ClientAlbumPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return <GalleryRoutePage loaderData={loaderData} actionData={actionData} />;
}
