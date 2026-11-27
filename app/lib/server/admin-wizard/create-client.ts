import type { TFunction } from "../../../i18n/t";
import { createIntent } from "../admin-clients/create";
import type { ClientActionResult } from "../admin-clients/errors";

/**
 * The wizard's "create your first client": the same intent as the clients
 * screen (same validation, same messages); only the place it goes back to
 * differs.
 */
export async function createWizardClient(
  env: Env,
  form: FormData,
  t: TFunction,
  backTo: string,
): Promise<ClientActionResult> {
  const result = await createIntent(env, form, t, () => backTo);
  // The wizard's form is told apart from the clients screen's by its own intent.
  return { ...result, intent: "createClient" };
}
