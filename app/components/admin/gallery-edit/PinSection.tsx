import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import { PIN_MAX, PIN_MIN } from "../../../lib/pin-rules";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import type { FieldErrors } from "./types";
import { btn, btnPrimary, Feedback, Field, inputCls, Section } from "./ui";

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
      <Form method="post" className="flex flex-col gap-3">
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
        <div>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {hasPin ? t("admin.edit.pin.change") : t("admin.edit.pin.save")}
          </button>
        </div>
      </Form>
      {hasPin && (
        <Form method="post">
          <input type="hidden" name="intent" value="pin" />
          <input type="hidden" name="mode" value="remove" />
          <button type="submit" className={btn} disabled={busy}>
            {t("admin.edit.pin.remove")}
          </button>
        </Form>
      )}
      <Feedback data={actionData} intent="pin" />
    </Section>
  );
}
