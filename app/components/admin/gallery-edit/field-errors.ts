import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import type { FieldErrors } from "./types";

/** Field errors of the last action when it was this intent's and failed. */
export function fieldErrorsOf(
  actionData: GalleryActionResult | undefined,
  intent: string,
): FieldErrors {
  return actionData && actionData.intent === intent && !actionData.ok
    ? (actionData.fieldErrors ?? {})
    : {};
}
