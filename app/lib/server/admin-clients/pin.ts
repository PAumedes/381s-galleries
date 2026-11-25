import { eq } from "drizzle-orm";
import { getDb, schema } from "../../../db";
import type { TFunction } from "../../../i18n/t";
import { PIN_MAX, PIN_MIN, isValidPin } from "../admin-galleries/actions/pin";
import { done, fail, str } from "../admin-galleries/actions/shared";
import { hashPin } from "../crypto";
import type { ClientActionResult } from "./errors";

/**
 * Writes the hash (or null) of one client; unknown client = 404. The
 * `clients_pin_epoch` trigger (0021) bumps `pin_epoch` when the hash changes
 * (download links carry it). Never logs the PIN.
 */
async function writePinHash(env: Env, id: string, pinHash: string | null) {
  const rows = await getDb(env)
    .update(schema.clients)
    .set({ pinHash })
    .where(eq(schema.clients.id, id))
    .returning({ id: schema.clients.id });
  if (!rows.length) throw new Response("Not found", { status: 404 });
}

/**
 * Sets or changes the client PIN (same hashing and rules as an album PIN).
 * Unlock cookies and download links carry a fingerprint of the hash: they die
 * with the old one. Every album of the client gets show_on_home = 0.
 */
export async function setPinIntent(
  env: Env,
  id: string,
  f: FormData,
  t: TFunction,
): Promise<ClientActionResult> {
  const pin = str(f, "pin");
  if (!isValidPin(pin))
    return fail("pinSet", t("admin.msg.pinCheck"), {
      pin: t("admin.msg.pinLength", { min: PIN_MIN, max: PIN_MAX }),
    });
  await writePinHash(env, id, await hashPin(pin));
  // Keeps the stored home flag honest: a client-PIN album is never on the home,
  // and must not reappear there if the PIN is removed later (the owner turns it on).
  await getDb(env)
    .update(schema.galleries)
    .set({ showOnHome: false })
    .where(eq(schema.galleries.clientId, id));
  return done("pinSet", t("admin.clients.msg.pinSaved"));
}

export async function removePinIntent(
  env: Env,
  id: string,
  t: TFunction,
): Promise<ClientActionResult> {
  await writePinHash(env, id, null);
  return done("pinRemove", t("admin.clients.msg.pinRemoved"));
}
