import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { ClientActionResult } from "../../../lib/server/admin-clients";
import { Feedback, Field } from "../gallery-edit/ui";
import { SubmitButton } from "./SubmitButton";
import { CLIENT_INPUT } from "./ui";

/** "Apply defaults to all albums": confirmed in the browser and again on the server. */
export function ApplyDefaultsForm({
  data,
}: {
  data: ClientActionResult | undefined;
}) {
  const t = useT();
  const mine = data?.intent === "applyDefaults" ? data : undefined;
  return (
    <Form
      method="post"
      className="flex flex-col gap-3"
      onSubmit={(ev) => {
        if (!window.confirm(t("admin.clients.apply.confirm")))
          ev.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="applyDefaults" />
      <input type="hidden" name="confirm" value="1" />
      <p className="text-small text-grey-700">
        {t("admin.clients.apply.note")}
      </p>
      <div>
        <SubmitButton
          intent="applyDefaults"
          primary={false}
          label={t("admin.clients.apply.button")}
          pendingLabel={t("admin.clients.apply.pending")}
        />
      </div>
      {mine?.ok && mine.message ? (
        <p role="status" className="border-ink border p-3 text-small">
          {mine.message}
        </p>
      ) : (
        <Feedback data={mine} intent="applyDefaults" />
      )}
    </Form>
  );
}

/** Danger zone: typed-slug confirmation (also checked by the server). */
export function DeleteClientForm({
  slug,
  hasPin = false,
  data,
}: {
  slug: string;
  hasPin?: boolean;
  data: ClientActionResult | undefined;
}) {
  const t = useT();
  return (
    <Form
      method="post"
      className="border-ink flex flex-col gap-3 border-2 p-4"
      onSubmit={(ev) => {
        if (
          !window.confirm(
            t(
              hasPin
                ? "admin.clients.delete.confirmPin"
                : "admin.clients.delete.confirm",
            ),
          )
        )
          ev.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="delete" />
      <p className="text-small text-grey-700">
        {t("admin.clients.delete.warning")}
        {hasPin && ` ${t("admin.clients.delete.warningPin")}`}
      </p>
      <Field label={t("admin.clients.delete.label", { slug })}>
        {(p) => (
          <input
            {...p}
            name="slug"
            required
            maxLength={120}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            data-compact
            className={CLIENT_INPUT}
          />
        )}
      </Field>
      <div>
        <SubmitButton
          intent="delete"
          label={t("admin.clients.delete.button")}
          pendingLabel={t("admin.clients.delete.pending")}
        />
      </div>
      <Feedback data={data} intent="delete" />
    </Form>
  );
}
