import { useRouteLoaderData } from "react-router";

import type { loader as rootLoader } from "../root";

export const DEFAULT_STUDIO_NAME = "381 Studios";

/** Studio name from the root loader (env STUDIO_NAME). */
export function useStudioName(): string {
  return (
    useRouteLoaderData<typeof rootLoader>("root")?.studioName ??
    DEFAULT_STUDIO_NAME
  );
}
