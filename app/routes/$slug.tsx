import { env } from "cloudflare:workers";

import { GalleryRoutePage } from "../components/GalleryRoutePage";
import { galleryRouteMeta } from "../lib/gallery-route-meta";
import {
  galleryAction,
  galleryHeaders,
  galleryLoader,
} from "../lib/server/gallery-route";
import type { Route } from "./+types/$slug";

export const loader = (args: Route.LoaderArgs) =>
  galleryLoader(args, { album: args.params.slug }, env);

export const action = (args: Route.ActionArgs) =>
  galleryAction(args, { album: args.params.slug }, env);

export const headers = (args: Route.HeadersArgs) => galleryHeaders(args);

export const meta = (args: Route.MetaArgs) => galleryRouteMeta(args);

export default function GalleryPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return <GalleryRoutePage loaderData={loaderData} actionData={actionData} />;
}
