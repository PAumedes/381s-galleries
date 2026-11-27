import { redirect } from "react-router";
import { getSetting, putSetting, SETTINGS_KEYS } from "../settings";

/** True once the owner chose "No mostrar más" on the admin home banner. */
export async function wizardDismissed(env: Env): Promise<boolean> {
  return (await getSetting(env, SETTINGS_KEYS.wizardDismissed)) === "1";
}

/** Remembers the choice (one `settings` row, no new table) and goes to `to`. */
export async function dismissWizard(env: Env, to: string): Promise<never> {
  await putSetting(env, SETTINGS_KEYS.wizardDismissed, "1");
  throw redirect(to, 303);
}
