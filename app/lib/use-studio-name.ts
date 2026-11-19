import { useRouteLoaderData } from "react-router";

import { DEFAULT_STUDIO_NAME } from "./default-studio-name";
import type { loader as rootLoader } from "../root";

/** Studio name from the root loader (env STUDIO_NAME). */
export function useStudioName(): string {
  return (
    useRouteLoaderData<typeof rootLoader>("root")?.studioName ??
    DEFAULT_STUDIO_NAME
  );
}
