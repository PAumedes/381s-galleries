import { eq } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { requestT } from "../../i18n/dictionaries";
import { adminAction } from "./admin";
import { isDeleting } from "./gallery-delete";
import { deleteIntent } from "./admin-galleries/actions/delete";
import { saveDetails } from "./admin-galleries/actions/details";
import { saveDesign } from "./admin-galleries/actions/design";
import { saveFlags } from "./admin-galleries/actions/flags";
import { saveHome } from "./admin-galleries/actions/home";
import { changeStatus } from "./admin-galleries/actions/status";
import { savePin } from "./admin-galleries/actions/pin";
import { saveCover } from "./admin-galleries/actions/cover";
import { saveFocus } from "./admin-galleries/actions/focus";
import { reorder } from "./admin-galleries/actions/reorder";
import { fail, str } from "./admin-galleries/actions/shared";
import type {
  GalleryActionDeps,
  GalleryActionResult,
} from "./admin-galleries/actions/shared";

// Public facade: the intents live one per file in admin-galleries/.
export { countGalleries, listGalleries } from "./admin-galleries/list";
export type { GalleryListRow } from "./admin-galleries/list";
export { loadGalleryEdit, photoSetVersion } from "./admin-galleries/edit";
export type { EditPhoto } from "./admin-galleries/edit";
export type {
  GalleryActionDeps,
  GalleryActionResult,
} from "./admin-galleries/actions/shared";
export {
  CLIENT_MAX,
  isConstraintError,
  SLUG_MAX,
  TITLE_MAX,
} from "./admin-galleries/actions/details";
export { PIN_MAX, PIN_MIN } from "./admin-galleries/actions/pin";
export { REORDER_CHUNK } from "./admin-galleries/actions/reorder";

export async function galleryAction(
  request: Request,
  env: Env,
  id: string,
  deps?: GalleryActionDeps,
): Promise<GalleryActionResult> {
  await adminAction(request, env);
  const t = requestT(request);
  const db = getDb(env);
  const [g] = await db
    .select()
    .from(schema.galleries)
    .where(eq(schema.galleries.id, id));
  if (!g) throw new Response("Not found", { status: 404 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("", t("admin.msg.invalidRequest"));
  }
  const intent = str(form, "intent");
  if (intent === "delete") return deleteIntent(env, g, form, t);
  // A gallery being deleted accepts nothing else.
  if (await isDeleting(env, g.driveFolderId))
    return fail(intent, t("admin.msg.stale"));
  switch (intent) {
    case "details":
      return saveDetails(env, g, form, t);
    case "design":
      return saveDesign(env, g, form, t);
    case "flags":
      return saveFlags(env, g, form, t);
    case "home":
      return saveHome(env, g, form, t);
    case "status":
      return changeStatus(env, g, str(form, "to"), t, deps);
    case "pin":
      return savePin(env, g, form, t);
    case "cover":
      return saveCover(env, g, form, t, deps);
    case "focus":
      return saveFocus(env, g, form, t);
    case "reorder":
      return reorder(env, g, form, t);
    default:
      return fail(intent, t("admin.msg.unknownAction"));
  }
}
