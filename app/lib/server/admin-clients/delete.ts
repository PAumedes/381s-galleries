import { redirect } from "react-router";
import type { TFunction } from "../../../i18n/t";
import { fail, str } from "../admin-galleries/actions/shared";
import { ClientError, deleteClient, getClient } from "../clients";
import type { ClientActionResult } from "./errors";

/** Danger zone: the admin types the client slug. Albums are unassigned, never deleted. */
export async function deleteIntent(
  env: Env,
  id: string,
  f: FormData,
  t: TFunction,
): Promise<ClientActionResult> {
  const client = await getClient(env, id);
  if (!client) throw new Response("Not found", { status: 404 });
  if (str(f, "slug").trim().toLowerCase() !== client.slug.toLowerCase())
    return fail("delete", t("admin.msg.deleteSlugMismatch"));
  try {
    await deleteClient(env, id);
  } catch (err) {
    if (err instanceof ClientError && err.code === "notFound")
      throw new Response("Not found", { status: 404 });
    throw err;
  }
  throw redirect("/admin/clients?deleted=1", 303);
}
