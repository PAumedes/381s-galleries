import { eq } from "drizzle-orm";
import { isExpired } from "../../time";
import { getDb, schema } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import { PIN_MAX, PIN_MIN } from "../../../pin-rules";
import { hashPin } from "../../crypto";
import { CONTROL_RE, done, fail, str } from "./shared";
import type { GalleryRow } from "./shared";

export { PIN_MAX, PIN_MIN };

/** Album and client PINs share one rule: 6 to 32 characters, no control characters. */
export const isValidPin = (pin: string) =>
  pin.length >= PIN_MIN && pin.length <= PIN_MAX && !CONTROL_RE.test(pin);

/**
 * True when, with no album PIN, nothing else gates the album: it is published,
 * not expired and its client (if any) has no PIN. Read after the update, so the
 * "open to anyone with the link" message is only shown when it is true.
 */
async function opensToAnyone(env: Env, galleryId: string): Promise<boolean> {
  const [row] = await getDb(env)
    .select({
      status: schema.galleries.status,
      expiresAt: schema.galleries.expiresAt,
      clientId: schema.galleries.clientId,
      clientPin: schema.clients.pinHash,
    })
    .from(schema.galleries)
    .leftJoin(schema.clients, eq(schema.galleries.clientId, schema.clients.id))
    .where(eq(schema.galleries.id, galleryId));
  return (
    !!row &&
    row.status === "published" &&
    !isExpired(row.expiresAt) &&
    row.clientPin === null
  );
}

export async function savePin(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
) {
  const intent = "pin";
  const mode = str(f, "mode");
  const db = getDb(env);
  if (mode === "remove") {
    await db
      .update(schema.galleries)
      .set({ pinHash: null })
      .where(eq(schema.galleries.id, g.id));
    const open = await opensToAnyone(env, g.id);
    return done(
      intent,
      t(open ? "admin.msg.pinRemovedOpen" : "admin.msg.pinRemoved"),
    );
  }
  if (mode !== "set") return fail(intent, t("admin.msg.unknownAction"));
  const pin = str(f, "pin");
  if (!isValidPin(pin))
    return fail(intent, t("admin.msg.pinCheck"), {
      pin: t("admin.msg.pinLength", { min: PIN_MIN, max: PIN_MAX }),
    });
  const pinHash = await hashPin(pin);
  // Sessions and download tokens carry pinFingerprint(pin_hash): they die with the old hash.
  await db
    .update(schema.galleries)
    .set({ pinHash, showOnHome: false })
    .where(eq(schema.galleries.id, g.id));
  return done(intent, t("admin.msg.pinSaved"));
}
