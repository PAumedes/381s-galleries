import { useRouteLoaderData } from "react-router";

import { DEFAULT_TIMEZONE } from "./studio-time";
import type { loader as rootLoader } from "../root";

/** Studio timezone from the root loader (env TIMEZONE, validated server-side). */
export function useStudioTimezone(): string {
  return (
    useRouteLoaderData<typeof rootLoader>("root")?.timezone ?? DEFAULT_TIMEZONE
  );
}
