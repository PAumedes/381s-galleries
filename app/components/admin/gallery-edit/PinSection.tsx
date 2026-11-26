import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import { PIN_MAX, PIN_MIN } from "../../../lib/pin-rules";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import type { FieldErrors } from "./types";
import { btn, btnPrimary, Feedback, Field, inputCls, Section } from "./ui";

const SET_FORM_ID = "album-pin-set";
const PIN_BTN = "w-full sm:w-auto";

export function PinSection({
  hasPin,
  errors: pe,
  busy,
  actionData,
}: {
  hasPin: boolean;
  errors: FieldErrors;
  busy: boolean;
  actionData: GalleryActionResult | undefined;
}) {
  const t = useT();

  return (
    <Section title={t("admin.edit.section.pin")}>
      <p className="text-body">
        {hasPin ? t("admin.edit.pin.active") : t("admin.edit.pin.none")}
      </p>
      <p className="text-small text-grey-600">{t("admin.edit.pin.note")}</p>
      <Form id={SET_FORM_ID} method="post" className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="pin" />
        <input type="hidden" name="mode" value="set" />
        <Field
          label={t("admin.edit.pin.new")}
          error={pe.pin}
          hint={t("admin.edit.pin.hint")}
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
              className={inputCls}
            />
          )}
        </Field>
      </Form>
      {/* Both buttons in one row from sm up, stacked full width on phones. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="submit"
          form={SET_FORM_ID}
          className={`${btnPrimary} ${PIN_BTN}`}
          disabled={busy}
        >
          {hasPin ? t("admin.edit.pin.change") : t("admin.edit.pin.save")}
        </button>
        {hasPin && (
          <Form method="post" className="contents">
            <input type="hidden" name="intent" value="pin" />
            <input type="hidden" name="mode" value="remove" />
            <button
              type="submit"
              className={`${btn} ${PIN_BTN}`}
              disabled={busy}
            >
              {t("admin.edit.pin.remove")}
            </button>
          </Form>
        )}
      </div>
      <Feedback data={actionData} intent="pin" />
    </Section>
  );
}
