import { asc, sql } from "drizzle-orm";
import { getDb, schema } from "../../../db";

/** Clients offered in the album select and the list filter (one query). */
export const CLIENT_CHOICES_MAX = 500;

export interface ClientChoice {
  id: string;
  name: string;
  slug: string;
  /** The client has a PIN (never the hash): unassigning an album removes that gate. */
  hasPin: boolean;
}

/**
 * Clients by name, at most CLIENT_CHOICES_MAX. `keepId` (the album's own
 * client) always makes the cut, so an assigned album never shows a blank select.
 */
export async function listClientChoices(
  env: Env,
  keepId: string | null = null,
): Promise<ClientChoice[]> {
  const c = schema.clients;
  const rows = await getDb(env)
    .select({
      id: c.id,
      name: c.name,
      slug: c.slug,
      hasPin: sql<number>`${c.pinHash} IS NOT NULL`,
    })
    .from(c)
    .orderBy(
      sql`${c.id} = ${keepId ?? ""} DESC`,
      asc(sql`${c.name} COLLATE NOCASE`),
      asc(c.slug),
    )
    .limit(CLIENT_CHOICES_MAX);
  const choices = rows.map((r) => ({ ...r, hasPin: !!r.hasPin }));
  return keepId
    ? choices.sort(
        (a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
          a.slug.localeCompare(b.slug),
      )
    : choices;
}
