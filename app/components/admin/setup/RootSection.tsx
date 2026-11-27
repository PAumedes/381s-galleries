import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { SetupActionData, SetupViewData } from "./types";
import { btnPrimary, Feedback, input, Section } from "./ui";

export function RootSection({
  data,
  actionData,
  busy,
}: {
  data: SetupViewData;
  actionData: SetupActionData | undefined;
  busy: boolean;
}) {
  const t = useT();
  return (
    <Section title={t("admin.setup.section.root")} help="drive-root">
      <p className="text-body">
        {data.rootName ? (
          <>
            {t("admin.setup.root.current")} <strong>{data.rootName}</strong>
          </>
        ) : (
          t("admin.setup.root.none")
        )}
      </p>
      <Form
        method="post"
        className="flex flex-col gap-3"
        onSubmit={(ev) => {
          if (data.rootName && !window.confirm(t("admin.setup.root.confirm")))
            ev.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="root" />
        {data.rootName && <input type="hidden" name="confirm" value="1" />}
        <label className="text-small flex flex-col gap-1">
          {t("admin.setup.root.label")}
          <input
            name="folder"
            required
            maxLength={300}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://drive.google.com/drive/folders/…"
            className={input}
          />
        </label>
        <p className="text-small text-grey-600">{t("admin.setup.root.note")}</p>
        <div>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {t("admin.setup.root.save")}
          </button>
        </div>
      </Form>
      <Feedback data={actionData} intent="root" />
    </Section>
  );
}
