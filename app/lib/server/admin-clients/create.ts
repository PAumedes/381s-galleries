import { redirect } from "react-router";
import type { TFunction } from "../../../i18n/t";
import { str } from "../admin-galleries/actions/shared";
import { createClient } from "../clients";
import { clientFail } from "./errors";
import type { ClientActionResult } from "./errors";

/** Name + optional slug (empty = generated from the name); success opens the edit page. */
export async function createIntent(
  env: Env,
  f: FormData,
  t: TFunction,
): Promise<ClientActionResult> {
  const slug = str(f, "slug").trim();
  let id: string;
  try {
    id = (
      await createClient(env, {
        name: str(f, "name"),
        ...(slug ? { slug } : {}),
      })
    ).id;
  } catch (err) {
    return clientFail("create", err, t);
  }
  throw redirect(`/admin/clients/${id}`, 303);
}
