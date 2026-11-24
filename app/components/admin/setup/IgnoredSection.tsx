import { Form } from "react-router";

import { useFormat } from "../../../i18n/use-format";
import { useT } from "../../../i18n/use-t";
import type { SetupActionData, SetupViewData } from "./types";
import { btn, Feedback, Section } from "./ui";

export function IgnoredSection({
  folders,
  actionData,
  busy,
}: {
  folders: NonNullable<SetupViewData["ignoredFolders"]>;
  actionData: SetupActionData | undefined;
  busy: boolean;
}) {
  const t = useT();
  const { dateTime } = useFormat();
  return (
    <Section title={t("admin.setup.section.ignored")}>
      <p className="text-small text-grey-600">
        {t("admin.setup.ignored.note")}
      </p>
      {folders.length === 0 ? (
        <p className="text-small">{t("admin.setup.ignored.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {folders.map((f) => (
            <li key={f.handle} className="flex flex-col gap-1">
              <span className="text-small text-grey-600">
                {t("admin.setup.ignored.deletedAt", {
                  date: dateTime(f.deletedAt),
                })}
              </span>
              <Form
                method="post"
                onSubmit={(ev) => {
                  if (!window.confirm(t("admin.setup.ignored.confirm")))
                    ev.preventDefault();
                }}
              >
                <input type="hidden" name="intent" value="reinclude" />
                <input type="hidden" name="confirm" value="1" />
                <input type="hidden" name="handle" value={f.handle} />
                <button type="submit" className={btn} disabled={busy}>
                  {t("admin.setup.ignored.reinclude")}
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}
      <Feedback data={actionData} intent="reinclude" />
    </Section>
  );
}
