import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { MessageKey } from "../../../i18n/t";
import type { GalleryActionResult } from "../../../lib/server/admin-galleries";
import type { EditGallery } from "./types";
import { btn, btnPrimary, Feedback, Section } from "./ui";

export function StatusSection({
  status,
  busy,
  actionData,
}: {
  status: EditGallery["status"];
  busy: boolean;
  actionData: GalleryActionResult | undefined;
}) {
  const t = useT();

  return (
    <Section title={t("admin.edit.section.status")}>
      <p className="text-small text-grey-700">{t("admin.edit.statusNote")}</p>
      <div className="flex flex-wrap gap-2">
        {(
          {
            draft: [
              ["publish", "admin.edit.action.publish"],
              ["archive", "admin.edit.action.archive"],
            ],
            published: [
              ["draft", "admin.edit.action.draft"],
              ["archive", "admin.edit.action.archive"],
            ],
            archived: [["restore", "admin.edit.action.restore"]],
          } as const satisfies Record<
            string,
            readonly (readonly [string, MessageKey])[]
          >
        )[status].map(([to, label]) => (
          <Form method="post" key={to}>
            <input type="hidden" name="intent" value="status" />
            <input type="hidden" name="to" value={to} />
            <button
              type="submit"
              className={to === "publish" ? btnPrimary : btn}
              disabled={busy}
            >
              {t(label)}
            </button>
          </Form>
        ))}
      </div>
      <Feedback data={actionData} intent="status" />
    </Section>
  );
}
