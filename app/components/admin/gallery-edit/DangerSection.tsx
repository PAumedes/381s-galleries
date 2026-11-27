import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import { btn, Feedback, inputCls, Section } from "./ui";

export function DangerSection({
  slug,
  deleting,
  busy,
  actionData,
}: {
  slug: string;
  deleting: boolean;
  busy: boolean;
  actionData: GalleryActionResult | undefined;
}) {
  const t = useT();

  return (
    <Section title={t("admin.edit.section.danger")} help="albums-delete">
      <Form
        method="post"
        className="border-ink flex flex-col gap-3 border-2 p-4"
        onSubmit={(ev) => {
          if (!window.confirm(t("admin.edit.delete.confirm")))
            ev.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="delete" />
        <p className="text-small text-grey-700">
          {t("admin.edit.delete.warning")}
        </p>
        {(deleting || actionData?.continuing) && (
          <p role="status" className="text-small">
            {t("admin.edit.delete.continuing")}
          </p>
        )}
        <label className="text-small flex flex-col gap-1">
          {t("admin.edit.delete.label", { slug: slug })}
          <input
            name="slug"
            required
            maxLength={120}
            autoComplete="off"
            spellCheck={false}
            className={inputCls}
          />
        </label>
        <div>
          <button type="submit" className={btn} disabled={busy}>
            {t("admin.edit.delete.button")}
          </button>
        </div>
        <Feedback data={actionData} intent="delete" />
      </Form>
    </Section>
  );
}
