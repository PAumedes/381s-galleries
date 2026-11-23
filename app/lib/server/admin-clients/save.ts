import { GALLERY_MODES, type GalleryMode } from "../../constants";
import type { TFunction } from "../../../i18n/t";
import { done, fail, str } from "../admin-galleries/actions/shared";
import { updateClient } from "../clients";
import { clientFail } from "./errors";
import type { ClientActionResult } from "./errors";

const isMode = (v: string): v is GalleryMode =>
  (GALLERY_MODES as readonly string[]).includes(v);

/** The whole details form: unchecked checkboxes are absent, i.e. false. */
export async function saveIntent(
  env: Env,
  id: string,
  f: FormData,
  t: TFunction,
): Promise<ClientActionResult> {
  const mode = str(f, "defaultMode");
  if (!isMode(mode))
    return fail("save", t("admin.msg.checkFields"), {
      defaultMode: t("admin.msg.modeInvalid"),
    });
  try {
    await updateClient(env, id, {
      name: str(f, "name"),
      slug: str(f, "slug"),
      pageEnabled: f.get("pageEnabled") === "1",
      defaultMode: mode,
      defaultShowOnHome: f.get("defaultShowOnHome") === "1",
    });
  } catch (err) {
    return clientFail("save", err, t);
  }
  return done("save", t("admin.clients.msg.saved"));
}
