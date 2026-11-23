import { DEFAULT_STUDIO_NAME } from "./default-studio-name";
import { clientPageMeta, galleryMeta } from "./og";
import { pwaMeta } from "./pwa";
import type { GalleryRouteData } from "./server/gallery-route";

/** `meta` export shared by `/:slug` and `/:client/:album`. */
export function galleryRouteMeta({
  loaderData: d,
  matches,
}: {
  loaderData: GalleryRouteData | undefined;
  matches: readonly ({ id: string; loaderData?: unknown } | undefined)[];
}) {
  const root = matches.find((m) => m?.id === "root")?.loaderData as
    { studioName?: string; lang?: string } | undefined;
  const studio = root?.studioName ?? DEFAULT_STUDIO_NAME;
  if (d?.state === "client")
    return [
      ...clientPageMeta(d, { studio, origin: d.origin }),
      ...pwaMeta(undefined, { studio }),
    ];
  return [
    ...galleryMeta(d, {
      studio,
      lang: root?.lang ?? "es",
      origin: d?.origin ?? "",
      clientSlug: d?.clientSlug,
    }),
    ...pwaMeta(d, { studio }),
  ];
}
