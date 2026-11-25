import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../../db";
import { requestT } from "../../i18n/dictionaries";
import { adminAction } from "./admin";
import { fail, str } from "./admin-galleries/actions/shared";
import { applyDefaultsIntent } from "./admin-clients/apply-defaults";
import { createIntent } from "./admin-clients/create";
import { deleteIntent } from "./admin-clients/delete";
import type { ClientActionResult } from "./admin-clients/errors";
import { saveIntent } from "./admin-clients/save";
import { requireAdmin } from "./auth";
import { getClient, listClients } from "./clients";
import { homeCoverIdSql } from "./cover";
import { CLIENT_CANDIDATE_CAP, listedOnClientPage } from "./home";

export type { ClientActionResult } from "./admin-clients/errors";

/** `/admin/clients`: the fields the list shows, nothing else. */
export async function clientsListData(request: Request, env: Env) {
  await requireAdmin(request, env);
  const t = requestT(request);
  const rows = await listClients(env);
  return {
    clients: rows.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      pageEnabled: c.pageEnabled,
      albumCount: c.albumCount,
    })),
    message:
      new URL(request.url).searchParams.get("deleted") === "1"
        ? t("admin.clients.msg.deleted")
        : null,
  };
}

/** `/admin/clients/:id`: the client and its albums (no Drive ids). 404 when unknown. */
export async function clientEditData(request: Request, env: Env, id: string) {
  await requireAdmin(request, env);
  const c = await getClient(env, id);
  if (!c) throw new Response("Not found", { status: 404 });
  const g = schema.galleries;
  const rows = await getDb(env)
    .select({
      id: g.id,
      title: g.title,
      slug: g.slug,
      status: g.status,
      mode: g.mode,
      expiresAt: g.expiresAt,
      coverId: homeCoverIdSql(),
      pinned: sql<number>`${g.pinHash} IS NOT NULL`,
    })
    .from(g)
    .where(eq(g.clientId, id))
    .orderBy(asc(g.title), asc(g.slug));
  const now = Date.now();
  const visible = Math.min(
    rows.filter((r) => listedOnClientPage(r, now)).length,
    CLIENT_CANDIDATE_CAP,
  );
  const albums = rows.map(({ id, title, slug, status, mode }) => ({
    id,
    title,
    slug,
    status,
    mode,
  }));
  return {
    publicPage: {
      visible,
      reason: !c.pageEnabled
        ? ("disabled" as const)
        : visible === 0
          ? ("none" as const)
          : null,
    },
    client: {
      id: c.id,
      name: c.name,
      slug: c.slug,
      pageEnabled: c.pageEnabled,
      defaultMode: c.defaultMode,
      defaultShowOnHome: c.defaultShowOnHome,
    },
    albums,
  };
}

async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

/** POST /admin/clients (create). */
export async function createClientAction(
  request: Request,
  env: Env,
): Promise<ClientActionResult> {
  await adminAction(request, env);
  const t = requestT(request);
  const form = await readForm(request);
  if (!form) return fail("create", t("admin.msg.invalidRequest"));
  return createIntent(env, form, t);
}

/** POST /admin/clients/:id: save | applyDefaults | delete. */
export async function clientAction(
  request: Request,
  env: Env,
  id: string,
): Promise<ClientActionResult> {
  await adminAction(request, env);
  const t = requestT(request);
  const form = await readForm(request);
  if (!form) return fail("", t("admin.msg.invalidRequest"));
  const intent = str(form, "intent");
  switch (intent) {
    case "save":
      return saveIntent(env, id, form, t);
    case "applyDefaults":
      return applyDefaultsIntent(env, id, form, t);
    case "delete":
      return deleteIntent(env, id, form, t);
    default:
      return fail(intent, t("admin.msg.unknownAction"));
  }
}
