import { useNavigation } from "react-router";

import { CLIENT_BTN, CLIENT_BTN_PRIMARY } from "./ui";

/**
 * Submit button of the client forms (T6.46). While any form is being submitted
 * (action running, or the redirect/revalidation after it) every client submit
 * is disabled, so Enter or a second tap cannot post twice; the one that was
 * pressed shows a spinner and its pending label. `intent` is the hidden
 * `intent` value of its form ("create" for the intent-less create form).
 */
export function SubmitButton({
  intent,
  label,
  pendingLabel,
  primary = true,
}: {
  intent: string;
  label: string;
  pendingLabel: string;
  primary?: boolean;
}) {
  const nav = useNavigation();
  const submitting = nav.state !== "idle" && nav.formData !== undefined;
  const mine =
    submitting && (nav.formData?.get("intent") ?? "create") === intent;
  return (
    <button
      type="submit"
      data-compact
      disabled={submitting}
      aria-busy={mine || undefined}
      className={`${primary ? CLIENT_BTN_PRIMARY : CLIENT_BTN} inline-flex items-center gap-2`}
    >
      {mine && (
        <span
          data-spinner
          aria-hidden="true"
          className="size-4 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
        />
      )}
      <span className="min-w-0">{mine ? pendingLabel : label}</span>
    </button>
  );
}
