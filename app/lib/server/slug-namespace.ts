import { getDb, schema } from "../../db";

/**
 * Gallery slugs and client slugs share ONE URL namespace (`/<slug>`), compared
 * case-insensitively. The app checks it here (both directions) for a friendly
 * error; the SQL triggers of migration 0020 catch the races.
 */
export const SLUG_TAKEN_TRIGGER_MESSAGE = "slug_taken";

/** `self`: the row being edited, which does not collide with itself. */
export async function slugInUse(
  env: Env,
  slug: string,
  self: { galleryId?: string; clientId?: string } = {},
): Promise<boolean> {
  // One query (the admin save path is D1-budgeted).
  const { results } = await env.DB.prepare(
    `SELECT 'g' AS kind, id FROM galleries WHERE slug = ?1 COLLATE NOCASE
     UNION ALL SELECT 'c' AS kind, id FROM clients WHERE slug = ?1 COLLATE NOCASE`,
  )
    .bind(slug)
    .all<{ kind: "g" | "c"; id: string }>();
  return results.some(
    (r) => r.id !== (r.kind === "g" ? self.galleryId : self.clientId),
  );
}

/** Every client slug, lower-cased (one query). */
export async function clientSlugs(env: Env): Promise<string[]> {
  const rows = await getDb(env)
    .select({ slug: schema.clients.slug })
    .from(schema.clients);
  return rows.map((r) => r.slug.toLowerCase());
}

/** Every slug in use (lower-cased), for generating a unique one. */
export async function allSlugs(env: Env): Promise<Set<string>> {
  const g = await getDb(env)
    .select({ slug: schema.galleries.slug })
    .from(schema.galleries);
  return new Set([
    ...g.map((r) => r.slug.toLowerCase()),
    ...(await clientSlugs(env)),
  ]);
}
