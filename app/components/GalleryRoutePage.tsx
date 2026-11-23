import type { GalleryRouteData } from "../lib/server/gallery-route";
import { ClientPage } from "./ClientPage";
import { GalleryView } from "./GalleryView";
import { PinScreen } from "./PinScreen";
import { UnavailableScreen } from "./UnavailableScreen";

/** Page body shared by `/:slug` and `/:client/:album`. */
export function GalleryRoutePage({
  loaderData,
  actionData,
}: {
  loaderData: GalleryRouteData;
  actionData?: { error?: string };
}) {
  switch (loaderData.state) {
    case "open":
      return (
        <GalleryView gallery={loaderData.gallery} photos={loaderData.photos} />
      );
    case "client":
      return <ClientPage page={loaderData} />;
    case "locked":
      return (
        <PinScreen
          title={loaderData.title}
          palette={loaderData.palette}
          error={actionData?.error}
        />
      );
    default:
      return <UnavailableScreen />;
  }
}
