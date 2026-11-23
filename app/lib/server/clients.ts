import { asc, eq, getTableColumns, sql } from "drizzle-orm";
import { getDb, schema } from "../../db";
import type { GalleryMode } from "../constants";
import { CONTROL_RE } from "./admin-galleries/actions/shared";
import { isConstraintError } from "./admin-galleries/actions/details";
import { isAllowedSlug, uniqueSlug } from "./slug";
import {
  SLUG_TAKEN_TRIGGER_MESSAGE,
  allSlugs,
  slugInUse,
} from "./slug-namespace";

export const CLIENT_NAME_MAX = 120;

export type ClientErrorCode =
  "slugTaken" | "invalidSlug" | "invalidName" | "notFound";

export class ClientError extends Error {
  constructor(readonly code: ClientErrorCode) {
    super(code);
    this.name = "ClientError";
  }
}

export type ClientRow = typeof schema.clients.$inferSelect;
export type ClientListRow = ClientRow & { albumCount: number };

export interface ClientInput {
  name: string;
  /** Default: generated from the name (uniqueClientSlug). */
  slug?: string;
  defaultMode?: GalleryMode;
  defaultShowOnHome?: boolean;
  pageEnabled?: boolean;
}

// Invisible format characters (\p{Cf}) are dropped, except ZWJ/ZWNJ (emoji
// sequences, Persian/Indic shaping) and the RTL/LTR marks that RTL names need.
const KEEP_INVISIBLE = new Set([0x200c, 0x200d, 0x200e, 0x200f]);
const INVISIBLE_RE = /[\p{Cf}\u2800\u3164\uFFA0]/gu;
const stripInvisible = (s: string) =>
  s.replace(INVISIBLE_RE, (c) =>
    KEEP_INVISIBLE.has(c.codePointAt(0)!) ? c : "",
  );
const VISIBLE_RE = /[\p{L}\p{N}\p{P}\p{S}]/u;

function cleanName(raw: string): string {
  const name = stripInvisible(raw).trim();
  if (
    !name ||
    name.length > CLIENT_NAME_MAX ||
    CONTROL_RE.test(name) ||
    !VISIBLE_RE.test(name)
  )
    throw new ClientError("invalidName");
  return name;
}

function cleanSlug(raw: string): string {
  const slug = raw.trim().toLowerCase();
  if (!isAllowedSlug(slug)) throw new ClientError("invalidSlug");
  return slug;
}

/** Slug for `name` that is not reserved and not used by any client or gallery. */
export async function uniqueClientSlug(env: Env, name: string) {
  return uniqueSlug(name, await allSlugs(env));
}

/** Maps the DB's slug errors (unique index, namespace trigger) to slugTaken. */
function rethrow(err: unknown): never {
  if (
    isConstraintError(err) ||
    String(err instanceof Error ? err.cause : "").includes(
      SLUG_TAKEN_TRIGGER_MESSAGE,
    ) ||
    String(err).includes(SLUG_TAKEN_TRIGGER_MESSAGE)
  )
    throw new ClientError("slugTaken");
  throw err;
}

export async function getClient(
  env: Env,
  id: string,
): Promise<ClientRow | null> {
  const rows = await getDb(env)
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, id));
  return rows[0] ?? null;
}

/** All clients by name with their album count: one query. */
export async function listClients(env: Env): Promise<ClientListRow[]> {
  return getDb(env)
    .select({
      ...getTableColumns(schema.clients),
      albumCount: sql<number>`(SELECT COUNT(*) FROM galleries AS a WHERE a.client_id = clients.id)`,
    })
    .from(schema.clients)
    .orderBy(
      asc(sql`${schema.clients.name} COLLATE NOCASE`),
      asc(schema.clients.slug),
    );
}

export async function createClient(
  env: Env,
  input: ClientInput,
): Promise<ClientRow> {
  const name = cleanName(input.name);
  const explicit = input.slug !== undefined;
  const slug = explicit
    ? cleanSlug(input.slug!)
    : await uniqueClientSlug(env, name);
  if (explicit && (await slugInUse(env, slug)))
    throw new ClientError("slugTaken");
  try {
    const rows = await getDb(env)
      .insert(schema.clients)
      .values({
        slug,
        name,
        ...(input.defaultMode && { defaultMode: input.defaultMode }),
        ...(input.defaultShowOnHome !== undefined && {
          defaultShowOnHome: input.defaultShowOnHome,
        }),
        ...(input.pageEnabled !== undefined && {
          pageEnabled: input.pageEnabled,
        }),
      })
      .returning();
    return rows[0]!;
  } catch (err) {
    return rethrow(err);
  }
}

export type ClientPatch = Partial<Omit<ClientInput, "slug">> & {
  slug?: string;
};

export async function updateClient(
  env: Env,
  id: string,
  patch: ClientPatch,
): Promise<ClientRow> {
  const set: Partial<typeof schema.clients.$inferInsert> = {};
  if (patch.name !== undefined) set.name = cleanName(patch.name);
  if (patch.slug !== undefined) set.slug = cleanSlug(patch.slug);
  if (patch.defaultMode !== undefined) set.defaultMode = patch.defaultMode;
  if (patch.defaultShowOnHome !== undefined)
    set.defaultShowOnHome = patch.defaultShowOnHome;
  if (patch.pageEnabled !== undefined) set.pageEnabled = patch.pageEnabled;
  const current = await getClient(env, id);
  if (!current) throw new ClientError("notFound");
  if (
    set.slug &&
    set.slug !== current.slug &&
    (await slugInUse(env, set.slug, { clientId: id }))
  )
    throw new ClientError("slugTaken");
  if (!Object.keys(set).length) return current;
  try {
    const rows = await getDb(env)
      .update(schema.clients)
      .set(set)
      .where(eq(schema.clients.id, id))
      .returning();
    if (!rows[0]) throw new ClientError("notFound");
    return rows[0];
  } catch (err) {
    if (err instanceof ClientError) throw err;
    return rethrow(err);
  }
}

/**
 * Deletes the client; its albums are kept and become unassigned. One batch
 * (2 statements, 1 bound parameter each): the FK would do the same, the explicit
 * UPDATE keeps it independent of the foreign_keys pragma.
 */
export async function deleteClient(env: Env, id: string): Promise<void> {
  const [, del] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE galleries SET client_id = NULL WHERE client_id = ?1",
    ).bind(id),
    env.DB.prepare("DELETE FROM clients WHERE id = ?1").bind(id),
  ]);
  if (!del!.meta.changes) throw new ClientError("notFound");
}

/** Sets only `galleries.client_id`; unknown album or client is notFound. */
export async function assignAlbum(
  env: Env,
  galleryId: string,
  clientId: string,
): Promise<void> {
  // One statement: a client deleted between a check and the UPDATE is notFound, not an FK error.
  const res = await env.DB.prepare(
    "UPDATE galleries SET client_id = ?1 WHERE id = ?2 AND EXISTS (SELECT 1 FROM clients WHERE id = ?1)",
  )
    .bind(clientId, galleryId)
    .run();
  if (!res.meta.changes) throw new ClientError("notFound");
}

export async function unassignAlbum(
  env: Env,
  galleryId: string,
): Promise<void> {
  await setClientId(env, galleryId, null);
}

async function setClientId(
  env: Env,
  galleryId: string,
  clientId: string | null,
) {
  const res = await env.DB.prepare(
    "UPDATE galleries SET client_id = ?1 WHERE id = ?2",
  )
    .bind(clientId, galleryId)
    .run();
  if (!res.meta.changes) throw new ClientError("notFound");
}
