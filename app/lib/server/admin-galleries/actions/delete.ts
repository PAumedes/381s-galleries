import { redirect } from "react-router";
import type { TFunction } from "../../../../i18n/t";
import { deleteGallery } from "../../gallery-delete";
import { fail, str } from "./shared";
import type { GalleryActionResult, GalleryRow } from "./shared";

/**
 * Danger zone: the admin must type the gallery slug (checked here, not in JS).
 * Success redirects to /admin; an unfinished deletion asks to be submitted again.
 */
export async function deleteIntent(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
): Promise<GalleryActionResult> {
  const intent = "delete";
  if (str(f, "slug").trim().toLowerCase() !== g.slug.toLowerCase())
    return fail(intent, t("admin.msg.deleteSlugMismatch"));
  let outcome: Awaited<ReturnType<typeof deleteGallery>>;
  try {
    outcome = await deleteGallery(env, g.id);
  } catch {
    // R2 or D1 failed: the gallery stays marked (and listed as "deleting");
    // submitting again resumes, every step is repeatable.
    console.error("delete gallery failed");
    return fail(intent, t("admin.msg.deleteFailed"));
  }
  switch (outcome) {
    case "deleted":
      throw redirect("/admin?deleted=1", 303);
    case "continue":
      return fail(intent, t("admin.msg.deleteContinuing"), undefined, {
        continuing: true,
      });
    case "busy":
      return fail(intent, t("admin.msg.deleteBusy"));
    case "not_found":
      throw new Response("Not found", { status: 404 });
  }
}
