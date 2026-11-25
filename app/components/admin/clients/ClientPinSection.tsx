import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import { PIN_MAX, PIN_MIN } from "../../../lib/pin-rules";
import type { ClientActionResult } from "../../../lib/server/admin-clients";
import { Feedback, Field, Section } from "../gallery-edit/ui";
import { SubmitButton } from "./SubmitButton";
import { CLIENT_INPUT } from "./ui";

/** Set / change / remove the client PIN (T6.52). The PIN and its hash are never rendered. */
export function ClientPinSection({
  hasPin,
  data,
}: {
  hasPin: boolean;
  data: ClientActionResult | undefined;
}) {
  const t = useT();
  const set = data?.intent === "pinSet" ? data : undefined;
  const removed = data?.intent === "pinRemove" ? data : undefined;
  return (
    <Section title={t("admin.clients.section.pin")}>
      <p className="text-body">
        {hasPin ? t("admin.clients.pin.active") : t("admin.clients.pin.none")}
      </p>
      <p className="text-small text-grey-600">{t("admin.clients.pin.note")}</p>
      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="pinSet" />
        <Field
          label={t("admin.clients.pin.new")}
          error={set?.fieldErrors?.pin}
          hint={t("admin.clients.pin.hint")}
        >
          {(p) => (
            <input
              {...p}
              type="password"
              name="pin"
              required
              minLength={PIN_MIN}
              maxLength={PIN_MAX}
              autoComplete="new-password"
              data-compact
              className={CLIENT_INPUT}
            />
          )}
        </Field>
        <div>
          <SubmitButton
            intent="pinSet"
            label={
              hasPin
                ? t("admin.clients.pin.change")
                : t("admin.clients.pin.save")
            }
            pendingLabel={t("admin.clients.pin.pending")}
          />
        </div>
        <Feedback data={set} intent="pinSet" />
      </Form>
      {hasPin && (
        <Form
          method="post"
          className="flex flex-col gap-3"
          onSubmit={(ev) => {
            if (!window.confirm(t("admin.clients.pin.removeConfirm")))
              ev.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="pinRemove" />
          <div>
            <SubmitButton
              intent="pinRemove"
              primary={false}
              label={t("admin.clients.pin.remove")}
              pendingLabel={t("admin.clients.pin.removePending")}
            />
          </div>
          <Feedback data={removed} intent="pinRemove" />
        </Form>
      )}
    </Section>
  );
}
