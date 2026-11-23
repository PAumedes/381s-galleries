import type { TFunction } from "../../../i18n/t";
import { CLIENT_NAME_MAX, ClientError } from "../clients";
import { SLUG_MAX } from "../slug";
import { fail } from "../admin-galleries/actions/shared";
import type { GalleryActionResult } from "../admin-galleries/actions/shared";

/** Result shape shared with the gallery actions (the `Feedback` component reads it). */
export type ClientActionResult = GalleryActionResult;

/**
 * Maps a ClientError to a localized field message; notFound is a 404 and any
 * other error is rethrown.
 */
export function clientFail(
  intent: string,
  err: unknown,
  t: TFunction,
): ClientActionResult {
  if (!(err instanceof ClientError)) throw err;
  const fields: Record<string, string> = {
    slugTaken: t("admin.clients.msg.slugTaken"),
    invalidSlug: t("admin.clients.msg.slugInvalid", { max: SLUG_MAX }),
    invalidName: t("admin.clients.msg.nameInvalid", { max: CLIENT_NAME_MAX }),
  };
  if (err.code === "notFound") throw new Response("Not found", { status: 404 });
  const field = err.code === "invalidName" ? "name" : "slug";
  return fail(intent, t("admin.msg.checkFields"), {
    [field]: fields[err.code]!,
  });
}
