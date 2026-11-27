import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import { PIN_MAX, PIN_MIN } from "../../../lib/pin-rules";
import type { ClientActionResult } from "../../../lib/server/admin-clients";
import { Feedback, Field, Section } from "../gallery-edit/ui";
import { SubmitButton } from "./SubmitButton";
import { CLIENT_INPUT } from "./ui";

const SET_FORM_ID = "client-pin-set";
const PIN_BTN = "w-full sm:w-auto";

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
    <Section title={t("admin.clients.section.pin")} help="access-pin-client">
      <p className="text-body">
        {hasPin ? t("admin.clients.pin.active") : t("admin.clients.pin.none")}
      </p>
      <p className="text-small text-grey-600">{t("admin.clients.pin.note")}</p>
      <Form id={SET_FORM_ID} method="post" className="flex flex-col gap-3">
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
      </Form>
      {/* Both buttons in one row from sm up, stacked full width on phones. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <SubmitButton
          form={SET_FORM_ID}
          className={PIN_BTN}
          intent="pinSet"
          label={
            hasPin ? t("admin.clients.pin.change") : t("admin.clients.pin.save")
          }
          pendingLabel={t("admin.clients.pin.pending")}
        />
        {hasPin && (
          <Form
            method="post"
            className="contents"
            onSubmit={(ev) => {
              if (!window.confirm(t("admin.clients.pin.removeConfirm")))
                ev.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="pinRemove" />
            <SubmitButton
              intent="pinRemove"
              primary={false}
              className={PIN_BTN}
              label={t("admin.clients.pin.remove")}
              pendingLabel={t("admin.clients.pin.removePending")}
            />
          </Form>
        )}
      </div>
      <Feedback data={set} intent="pinSet" />
      <Feedback data={removed} intent="pinRemove" />
    </Section>
  );
}
