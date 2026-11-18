import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";

import { AdminGalleryPreview } from "../components/admin/AdminGalleryPreview";
import { getDb, schema } from "../db";
import { metaT, type MetaMatches } from "../i18n/meta";
import { adminHeaders } from "../lib/server/admin";
import { requireAdmin } from "../lib/server/auth";
import { buildOpenData } from "../lib/server/gallery";
import { isExpired } from "../lib/server/time";
import type { Route } from "./+types/admin.g.$id.preview";

/**
 * GET /admin/g/:id/preview: the real client gallery, for the owner only, in
 * any state (draft, PIN, archived, expired). Outside the admin layout (no
 * shell) and read-only: it never logs a view, never creates a visitor or a
 * session cookie, and the page talks to no public API (favourites stay in
 * memory, downloads are off). Images come from `/admin/img` (admin-guarded,
 * `no-store`), watermarked in Prueba like the client sees them.
 */
export const headers = () => adminHeaders();

export const meta = (args?: { matches?: MetaMatches["matches"] }) => [
  ...(args?.matches
    ? [{ title: metaT(args.matches)("admin.preview.metaTitle") }]
    : []),
  { name: "robots", content: "noindex, nofollow" },
];

/** Admin-guarded loader body: 401 for non-admins (first), 404 for an unknown id. */
export async function previewData(request: Request, e: Env, id: string) {
  await requireAdmin(request, e);
  const [g] = await getDb(e)
    .select()
    .from(schema.galleries)
    .where(eq(schema.galleries.id, id));
  if (!g) throw new Response("Not found", { status: 404 });
  const { gallery, photos } = await buildOpenData(e, g);
  return {
    id: g.id,
    status: g.status,
    hasPin: g.pinHash !== null,
    expired: isExpired(g.expiresAt),
    gallery,
    photos,
  };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return previewData(request, env, params.id);
}

export default function AdminPreviewPage({ loaderData }: Route.ComponentProps) {
  return <AdminGalleryPreview data={loaderData} />;
}
