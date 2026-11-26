import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import { done, fail } from "./shared";
import type { GalleryRow } from "./shared";

/**
 * "Versiones" (T6.53b2): turns `galleries.versioning` on or off. Only "1"/"0".
 * The next sync reads the album's versions (sync-version-rows.ts); nothing
 * else about the gallery changes.
 */
export async function saveVersioning(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
) {
  const intent = "versioning";
  const raw = f.get("versioning");
  if (raw !== "1" && raw !== "0")
    return fail(intent, t("admin.msg.checkFields"), {
      versioning: t("admin.msg.valueInvalid"),
    });
  const on = raw === "1";
  await getDb(env)
    .update(schema.galleries)
    .set({ versioning: on })
    .where(eq(schema.galleries.id, g.id));
  return done(
    intent,
    on ? t("admin.msg.versionsOn") : t("admin.msg.versionsOff"),
  );
}
