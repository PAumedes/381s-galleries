import { Form } from "react-router";

import { useT } from "../../../../i18n/use-t";
import type {
  WizardActionResult,
  WizardData,
} from "../../../../lib/server/admin-wizard";
import { wizardStepHref, type WizardStep } from "../../../../lib/wizard";
import { Field } from "../../gallery-edit/ui";
import { StatusNote } from "../StatusNote";
import { StepFrame } from "../StepFrame";
import { WIZ_INPUT, WIZ_LINK } from "../ui";
import { WizardSubmit } from "../WizardSubmit";

/** The wizard's client step is number 3: errors come back to this URL. */
const CLIENT_STEP = 3;

/** 3: create a client with the same action as the clients screen (name only; the address is made from it). */
export function ClientStep({
  step,
  data,
  actionData,
}: {
  step: WizardStep;
  data: WizardData;
  actionData: WizardActionResult | undefined;
}) {
  const t = useT();
  const err =
    actionData?.intent === "createClient" && !actionData.ok
      ? actionData
      : undefined;
  return (
    <StepFrame step={step}>
      <StatusNote>
        {data.clients > 0
          ? t("admin.wizard.client.some", { count: data.clients })
          : t("admin.wizard.client.none")}
      </StatusNote>
      <Form
        method="post"
        action={wizardStepHref(CLIENT_STEP)}
        className="flex max-w-prose flex-col gap-3"
      >
        <input type="hidden" name="intent" value="createClient" />
        <Field
          large
          label={t("admin.clients.field.name")}
          error={err?.fieldErrors?.name}
          hint={t("admin.wizard.client.hint")}
        >
          {(p) => (
            <input
              {...p}
              name="name"
              required
              maxLength={120}
              autoComplete="off"
              className={WIZ_INPUT}
            />
          )}
        </Field>
        <div>
          <WizardSubmit
            label={t("admin.clients.create.button")}
            pendingLabel={t("admin.clients.create.pending")}
          />
        </div>
        {err && !err.fieldErrors && (
          <p role="alert" className="border-ink border p-3 text-base">
            {err.error}
          </p>
        )}
      </Form>
      {data.clients > 0 && (
        <div>
          <a href="/admin/clients" className={WIZ_LINK}>
            {t("admin.nav.clients")}
          </a>
        </div>
      )}
    </StepFrame>
  );
}
