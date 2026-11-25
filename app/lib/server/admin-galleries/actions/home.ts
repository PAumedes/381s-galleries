import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import { isExpired } from "../../time";
import { done, fail } from "./shared";
import type { GalleryRow } from "./shared";

/**
 * "Mostrar en la portada" (T6.6). Only "1"/"0". Enabling needs a published
 * gallery without PIN, its own or its client's (the home query enforces the same, this keeps the stored
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
  // Looked up only when turning on (one extra read), never for the other intents.
  const pinned = on && (g.pinHash !== null || (await clientHasPin(env, g)));
  if (on && (pinned || g.status !== "published"))
    return fail(intent, t("admin.msg.checkFields"), {
      showOnHome: pinned
        ? t("admin.msg.homePin")
        : t("admin.msg.homeUnpublished"),
    });
  await getDb(env)
    .update(schema.galleries)
    .set({ showOnHome: on })
    .where(eq(schema.galleries.id, g.id));
  return done(intent, on ? t("admin.msg.homeOn") : t("admin.msg.homeOff"));
}

/** True when the album's client has a PIN (it gates the album like its own). */
async function clientHasPin(env: Env, g: GalleryRow): Promise<boolean> {
  if (!g.clientId) return false;
  const [c] = await getDb(env)
    .select({ pinHash: schema.clients.pinHash })
    .from(schema.clients)
    .where(eq(schema.clients.id, g.clientId));
  return !!c && c.pinHash !== null;
}
