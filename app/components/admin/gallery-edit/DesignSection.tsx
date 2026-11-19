import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { Design } from "../../../lib/design";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import { DesignPanel } from "../DesignPanel";
import type { FieldErrors } from "./types";
import { btn, btnPrimary, Feedback, Section } from "./ui";

/** Diseño tab form. Its save button lives in the preview column (DesignBar). */
export function DesignSection({
  formId,
  design,
  onChange,
  errors,
  actionData,
}: {
  formId: string;
  design: Design;
  onChange: (d: Design) => void;
  errors: FieldErrors;
  actionData: GalleryActionResult | undefined;
}) {
  const t = useT();
  return (
    <Section title={t("admin.edit.section.design")}>
      <Form
        id={formId}
        data-design-form=""
        method="post"
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="intent" value="design" />
        <DesignPanel design={design} onChange={onChange} errors={errors} />
        <p className="text-small text-grey-600">{t("admin.edit.designNote")}</p>
        <Feedback data={actionData} intent="design" />
      </Form>
    </Section>
  );
}

/** Saved / unsaved status with Discard and Save, pinned to the bottom on phones. */
export function DesignBar({
  formId,
  dirty,
  busy,
  onDiscard,
}: {
  formId: string;
  dirty: boolean;
  busy: boolean;
  onDiscard: () => void;
}) {
  const t = useT();
  return (
    <div
      className={`bg-paper border-grey-200 flex flex-wrap items-center gap-2 border-t pt-3 ${dirty ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:px-4 max-lg:pb-3" : ""}`}
    >
      <p role="status" className="text-small mr-auto flex items-center gap-2">
        {dirty ? (
          <>
            <span
              aria-hidden="true"
              className="bg-ink inline-block size-2 rounded-full"
            />
            <span>{t("admin.design.unsaved")}</span>
          </>
        ) : (
          <span className="text-grey-600">{t("admin.design.saved")}</span>
        )}
      </p>
      <button
        type="button"
        className={btn}
        disabled={!dirty}
        onClick={onDiscard}
      >
        {t("admin.design.discard")}
      </button>
      <button
        type="submit"
        form={formId}
        className={btnPrimary}
        disabled={busy || !dirty}
      >
        {t("admin.edit.saveDesign")}
      </button>
    </div>
  );
}
