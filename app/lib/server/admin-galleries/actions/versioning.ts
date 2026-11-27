import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import { queueVersionCaches } from "../../r2-pending";
import { deleteSetting, SETTINGS_KEYS } from "../../settings";
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
  // The form posts a hidden 0 first and the checkbox 1 after it: the last wins.
  const raw = f.getAll("versioning").at(-1);
  if (raw !== "1" && raw !== "0")
    return fail(intent, t("admin.msg.checkFields"), {
      versioning: t("admin.msg.valueInvalid"),
    });
  const on = raw === "1";
  // Nothing to re-read when the value is the one already stored.
  if (g.versioning === on)
    return done(
      intent,
      on ? t("admin.msg.versionsOn") : t("admin.msg.versionsOff"),
    );
  await getDb(env)
    .update(schema.galleries)
    .set({ versioning: on })
    .where(eq(schema.galleries.id, g.id));
  // Drive may report no change after the switch: forget the changes token so
  // the next sync rescans and reads (or drops) the versions.
  await deleteSetting(env, SETTINGS_KEYS.driveChangesToken);
  // Switching OFF keeps the version rows but nothing serves their cached
  // objects any more: queue them for deletion (T6.55).
  if (!on) await queueVersionCaches(env, g.id);
  return done(
    intent,
    on ? t("admin.msg.versionsOn") : t("admin.msg.versionsOff"),
  );
}
