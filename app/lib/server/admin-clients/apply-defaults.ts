import type { TFunction } from "../../../i18n/t";
import { done, fail, str } from "../admin-galleries/actions/shared";
import { getClient } from "../clients";
import type { ClientActionResult } from "./errors";

const ALBUM_COUNT_SQL =
  "SELECT COUNT(*) AS n FROM galleries WHERE client_id = ?1";

const UPDATE_SQL = `UPDATE galleries SET mode = c.default_mode,
  show_on_home = CASE WHEN c.default_show_on_home = 1
    AND galleries.status = 'published' AND galleries.pin_hash IS NULL
    AND c.pin_hash IS NULL
    AND (galleries.expires_at IS NULL OR galleries.expires_at = '' OR unixepoch(galleries.expires_at, 'subsec') * 1000 > ?2)
    THEN 1 ELSE 0 END
  FROM clients AS c WHERE c.id = ?1 AND galleries.client_id = c.id`;

/** Albums of the client in Prueba with no visible photo that has a preview-wm. */
const NO_WM_COUNT_SQL = `SELECT COUNT(*) AS n FROM galleries g
  WHERE g.client_id = ?1 AND g.mode = 'proofing' AND NOT EXISTS (
    SELECT 1 FROM photos p WHERE p.gallery_id = g.id AND p.missing_since IS NULL
      AND NULLIF(p.drive_wm_id, '') IS NOT NULL)`;

/**
 * One UPDATE: the client's saved mode and show-on-home go to all its albums.
 * The stored home flag stays honest (as the `home` intent): on only for a
 * published, unexpired album with no PIN of its own or of its client. Prueba only warns about missing
 * preview-wm (T6.19), it never blocks.
 */
export async function applyDefaultsIntent(
  env: Env,
  id: string,
  f: FormData,
  t: TFunction,
): Promise<ClientActionResult> {
  const intent = "applyDefaults";
  if (str(f, "confirm") !== "1")
    return fail(intent, t("admin.clients.msg.applyConfirm"));
  const client = await getClient(env, id);
  if (!client) throw new Response("Not found", { status: 404 });
  // `meta.changes` also counts trigger writes, so the album count is a SELECT in the same batch.
  const [, albums, noWm] = await env.DB.batch([
    env.DB.prepare(UPDATE_SQL).bind(id, Date.now()),
    env.DB.prepare(ALBUM_COUNT_SQL).bind(id),
    env.DB.prepare(NO_WM_COUNT_SQL).bind(id),
  ]);
  const count = (albums!.results[0] as { n: number }).n;
  const missing = (noWm!.results[0] as { n: number }).n;
  let message = t("admin.clients.msg.applied", { count });
  if (client.defaultMode === "proofing" && missing > 0)
    message += ` ${t("admin.clients.msg.applyNoWm", { count: missing })}`;
  return done(intent, message);
}
