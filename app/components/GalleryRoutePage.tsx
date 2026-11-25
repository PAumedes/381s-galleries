import { useState } from "react";

import type { GalleryRouteData } from "../lib/server/gallery-route";
import type { BackToClientLink } from "./BackToClient";
import { ClientPage } from "./ClientPage";
import { GalleryView } from "./GalleryView";
import { PinScreen } from "./PinScreen";
import { UnavailableScreen } from "./UnavailableScreen";

/**
 * The back link of the album shown. It arrives with the request whose Referer
 * was the client page; a later revalidation (or the PIN unlock) of the same
 * album has another Referer and would drop it, so it is kept while the page
 * stays on that album and client. Never carried to another album or client.
 */
function useKeptBackLink(
  loaderData: GalleryRouteData,
): BackToClientLink | undefined {
  const [kept, setKept] = useState<{
    key: string;
    link: BackToClientLink;
  } | null>(null);
  const slug =
    loaderData.state === "open"
      ? loaderData.gallery.slug
      : loaderData.state === "locked"
        ? loaderData.slug
        : null;
  if (slug === null) return undefined;
  // Keyed on album AND client: moved/unassigned/deleted-client drops the link.
  const key = `${slug}\n${loaderData.clientSlug ?? ""}`;
  const fresh = loaderData.backToClient;
  if (
    fresh &&
    (kept?.key !== key ||
      kept.link.href !== fresh.href ||
      kept.link.name !== fresh.name)
  )
    setKept({ key, link: fresh });
  return fresh ?? (kept?.key === key ? kept.link : undefined);
}

/** Page body shared by `/:slug` and `/:client/:album`. */
export function GalleryRoutePage({
  loaderData,
  actionData,
}: {
  loaderData: GalleryRouteData;
  actionData?: { error?: string; attempt?: number };
}) {
  const backToClient = useKeptBackLink(loaderData);
  switch (loaderData.state) {
    case "open":
      return (
        <GalleryView
          gallery={loaderData.gallery}
          photos={loaderData.photos}
          backToClient={backToClient}
        />
      );
    case "client":
      return <ClientPage page={loaderData} />;
    case "locked":
      return (
        <PinScreen
          title={loaderData.title}
          palette={loaderData.palette}
          step={loaderData.step}
          clientAccepted={loaderData.clientAccepted}
          error={actionData?.error}
          attempt={actionData?.attempt}
        />
      );
    default:
      return <UnavailableScreen />;
  }
}
