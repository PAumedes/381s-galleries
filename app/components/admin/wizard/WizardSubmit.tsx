import { useNavigation } from "react-router";

import { WIZ_BTN, WIZ_BTN_PRIMARY } from "./ui";

/** Submit button that is disabled while any form is being sent, so a second tap cannot post twice. */
export function WizardSubmit({
  label,
  pendingLabel,
  primary = true,
}: {
  label: string;
  pendingLabel?: string;
  primary?: boolean;
}) {
  const nav = useNavigation();
  const busy = nav.state !== "idle" && nav.formData !== undefined;
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy || undefined}
      className={primary ? WIZ_BTN_PRIMARY : WIZ_BTN}
    >
      {busy && pendingLabel ? pendingLabel : label}
    </button>
  );
}
