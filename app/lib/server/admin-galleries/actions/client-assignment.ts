import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "../../../../db";
import type { TFunction } from "../../../../i18n/t";
import { hasWmSql } from "../../cover";
import { isExpired } from "../../time";
import { str } from "./shared";
import type { GalleryRow } from "./shared";

type GallerySet = Partial<typeof schema.galleries.$inferInsert>;

/** What the details save does about the album's client (T6.40c). */
export interface ClientChange {
  /** The form named an unknown client: nothing is saved. */
  error?: string;
  /** Columns for the one details UPDATE (empty = client untouched). */
  set: GallerySet;
  /** Sentences for the save message (assigned, copied fields, Prueba warning). */
  note: string;
  /** Client id the UPDATE tries to assign (verify it stuck, see `assignedClientId`). */
  assignId?: string;
}

const UNCHANGED: ClientChange = { set: {}, note: "" };

/**
 * `clientId` in the details form: absent = untouched, "" = no client, an id =
 * that client (unknown id is refused). Going from NO client to a client copies
 * the client's mode and show-on-home once; moving between clients or to none
 * keeps the album's own settings (owner decision, T6.40). The client id is
 * written through a sub-select, so a client deleted meanwhile leaves the album
 * unassigned instead of failing on the foreign key.
 */
export async function planClientChange(
  env: Env,
  g: GalleryRow,
  f: FormData,
  t: TFunction,
  expiresAt: string | null,
): Promise<ClientChange> {
  if (!f.has("clientId")) return UNCHANGED;
  const id = str(f, "clientId");
  if (id === (g.clientId ?? "")) return UNCHANGED;
  if (!id)
    return {
      set: { clientId: null },
      note: t("admin.msg.clientUnassigned"),
    };
  const [client] = await getDb(env)
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, id));
  if (!client)
    return { set: {}, note: "", error: t("admin.msg.clientUnknown") };
  // Every client-derived column is guarded by the client still existing, so a
  // client deleted since the select above changes nothing (not even the copies).
  const exists = sql`EXISTS (SELECT 1 FROM clients WHERE id = ${id})`;
  const guard = (column: string, value: string | number) =>
    sql`CASE WHEN ${exists} THEN ${value} ELSE ${sql.raw(column)} END` as never;
  const set: GallerySet = {
    clientId: sql`(SELECT id FROM clients WHERE id = ${id})` as never,
  };
  let note = t("admin.msg.clientAssigned", { client: client.name });
  if (g.clientId) return { set, note, assignId: id };

  const eligible =
    g.status === "published" &&
    !g.pinHash &&
    client.pinHash === null &&
    !isExpired(expiresAt, Date.now());
  const showOnHome = client.defaultShowOnHome && eligible;
  const copied: string[] = [];
  if (client.defaultMode !== g.mode) {
    set.mode = guard("mode", client.defaultMode);
    copied.push(
      t("admin.msg.clientCopiedMode", {
        mode: t(`admin.mode.${client.defaultMode}`),
      }),
    );
  }
  if (showOnHome !== g.showOnHome) {
    set.showOnHome = guard("show_on_home", showOnHome ? 1 : 0);
    copied.push(
      t(
        showOnHome
          ? "admin.msg.clientCopiedHomeOn"
          : "admin.msg.clientCopiedHomeOff",
      ),
    );
  }
  if (copied.length)
    note += ` ${t("admin.msg.clientCopied", { fields: copied.join(", ") })}`;
  if (client.defaultMode === "proofing" && set.mode)
    note += await noWmWarning(env, g.id, t);
  return { set, note, assignId: id };
}

/** True when the album ended up in client `id` (false: the client vanished). */
export async function isAssignedTo(env: Env, galleryId: string, id: string) {
  const [r] = await getDb(env)
    .select({ clientId: schema.galleries.clientId })
    .from(schema.galleries)
    .where(eq(schema.galleries.id, galleryId));
  return r?.clientId === id;
}

/** Prueba only warns (T6.19): visible photos without preview-wm show as unavailable. */
async function noWmWarning(env: Env, galleryId: string, t: TFunction) {
  const [r] = await getDb(env)
    .select({ n: sql<number>`count(*)` })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.galleryId, galleryId),
        isNull(schema.photos.missingSince),
        sql`NOT ${hasWmSql("photos.drive_wm_id")}`,
      ),
    );
  const count = r?.n ?? 0;
  return count > 0 ? ` ${t("admin.msg.clientNoWm", { count })}` : "";
}
