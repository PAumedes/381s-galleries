import { Form } from "react-router";

import { GALLERY_MODES } from "../../../lib/constants";
import { useT } from "../../../i18n/use-t";
import type { ClientActionResult } from "../../../lib/server/admin-clients";
import { Feedback, Field } from "../gallery-edit/ui";
import { SubmitButton } from "./SubmitButton";
import { CLIENT_INPUT } from "./ui";
import type { ClientEditItem } from "./ClientEditView";

function CheckRow({
  name,
  label,
  checked,
}: {
  name: string;
  label: string;
  checked: boolean;
}) {
  return (
    <label className="text-small flex min-h-12 items-center gap-3 md:min-h-10">
      <input
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={checked}
        className="size-6 md:size-4"
      />
      {label}
    </label>
  );
}

/** The name and the public slug inputs. */
function NameAndSlug({
  client,
  errors: errs,
}: {
  client: ClientEditItem;
  errors: Record<string, string> | undefined;
}) {
  const t = useT();
  return (
    <>
      <Field label={t("admin.clients.field.name")} error={errs?.name}>
        {(p) => (
          <input
            {...p}
            name="name"
            required
            maxLength={120}
            defaultValue={client.name}
            autoComplete="off"
            data-compact
            className={CLIENT_INPUT}
          />
        )}
      </Field>
      <Field
        label={t("admin.clients.field.slug")}
        error={errs?.slug}
        hint={t("admin.clients.field.slugHint")}
      >
        {(p) => (
          <input
            {...p}
            name="slug"
            required
            maxLength={60}
            defaultValue={client.slug}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            data-compact
            className={CLIENT_INPUT}
          />
        )}
      </Field>
    </>
  );
}

/** Radios for the mode new albums of this client start in, each with its note. */
function DefaultModeFieldset({
  current,
  error,
}: {
  current: ClientEditItem["defaultMode"];
  error: string | undefined;
}) {
  const t = useT();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-small mb-1">
        {t("admin.clients.field.defaultMode")}
      </legend>
      {GALLERY_MODES.map((m) => (
        <label
          key={m}
          className="text-small flex min-h-12 items-start gap-3 py-2 md:min-h-10"
        >
          <input
            type="radio"
            name="defaultMode"
            value={m}
            defaultChecked={current === m}
            className="mt-1 size-5 md:size-4"
          />
          <span className="flex min-w-0 flex-col">
            {t(`admin.mode.${m}`)}
            <span className="text-grey-600">
              {t(`admin.edit.mode.${m}Note`)}
            </span>
          </span>
        </label>
      ))}
      {error && (
        <p role="alert" className="text-small text-ink font-medium">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function ClientDetailsForm({
  client,
  data,
}: {
  client: ClientEditItem;
  data: ClientActionResult | undefined;
}) {
  const t = useT();
  const mine = data?.intent === "save" ? data : undefined;
  const errs = mine?.fieldErrors;
  return (
    <Form method="post" className="flex flex-col gap-4">
      <input type="hidden" name="intent" value="save" />
      <NameAndSlug client={client} errors={errs} />
      <CheckRow
        name="pageEnabled"
        label={t("admin.clients.field.pageEnabled")}
        checked={client.pageEnabled}
      />
      <DefaultModeFieldset
        current={client.defaultMode}
        error={errs?.defaultMode}
      />
      <CheckRow
        name="defaultShowOnHome"
        label={t("admin.clients.field.defaultShowOnHome")}
        checked={client.defaultShowOnHome}
      />
      <div>
        <SubmitButton
          intent="save"
          label={t("admin.clients.save")}
          pendingLabel={t("admin.clients.save.pending")}
        />
      </div>
      <Feedback data={mine} intent="save" />
    </Form>
  );
}
