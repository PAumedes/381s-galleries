import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import { isExpired } from "../../time";
import { done, fail } from "./shared";
import type { GalleryRow } from "./shared";

/**
 * "Mostrar en la portada" (T6.6). Only "1"/"0". Enabling needs a published
 * gallery without PIN (the home query enforces the same, this keeps the stored
 * flag honest); disabling always works.
 */
export async function saveHome(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
) {
  const intent = "home";
  const raw = f.get("showOnHome");
  if (raw !== "1" && raw !== "0")
    return fail(intent, t("admin.msg.checkFields"), {
      showOnHome: t("admin.msg.valueInvalid"),
    });
  const on = raw === "1";
  if (on && isExpired(g.expiresAt, Date.now()))
    return fail(intent, t("admin.msg.checkFields"), {
      showOnHome: t("admin.msg.homeExpired"),
    });
  if (on && (g.pinHash !== null || g.status !== "published"))
    return fail(intent, t("admin.msg.checkFields"), {
      showOnHome:
        g.pinHash !== null
          ? t("admin.msg.homePin")
          : t("admin.msg.homeUnpublished"),
    });
  await getDb(env)
    .update(schema.galleries)
    .set({ showOnHome: on })
    .where(eq(schema.galleries.id, g.id));
  return done(intent, on ? t("admin.msg.homeOn") : t("admin.msg.homeOff"));
}
