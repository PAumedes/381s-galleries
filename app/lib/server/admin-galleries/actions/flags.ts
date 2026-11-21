import { eq } from "drizzle-orm";
import type { GalleryMode } from "../../../constants";
import { getDb, schema } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import { done, fail } from "./shared";
import type { GalleryRow } from "./shared";

export async function saveFlags(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
) {
  const intent = "flags";
  const on = (k: string) => f.get(k) === "1";
  const modeRaw = f.get("mode");
  if (modeRaw !== null && modeRaw !== "proofing" && modeRaw !== "delivery")
    return fail(intent, t("admin.msg.checkFields"), {
      mode: t("admin.msg.modeInvalid"),
    });
  const mode: GalleryMode = modeRaw ?? g.mode;
  await getDb(env)
    .update(schema.galleries)
    .set({
      // Prueba: the form disables the download boxes (not submitted), so keep
      // the stored values for when the gallery goes back to Entrega.
      ...(mode === "proofing"
        ? {}
        : {
            allowHighres: on("allowHighres"),
            allowWeb: on("allowWeb"),
            allowIg: on("allowIg"),
            allowBulk: on("allowBulk"),
          }),
      requireEmail: on("requireEmail"),
      mode,
    })
    .where(eq(schema.galleries.id, g.id));
  return done(intent, t("admin.msg.optionsSaved"));
}
