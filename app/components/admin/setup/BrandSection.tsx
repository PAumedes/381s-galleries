import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { SetupActionData, SetupViewData } from "./types";
import { btnPrimary, Feedback, input, Section } from "./ui";

export function BrandSection({
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
    <Section title={t("admin.setup.section.brand")} help="start-brand">
      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="intent" value="studio" />
        <label className="text-small flex flex-col gap-1">
          {t("admin.setup.brand.name")}
          <input
            name="studioName"
            required
            minLength={1}
            maxLength={60}
            defaultValue={data.studioName}
            className={input}
          />
        </label>
        <div>
          <button type="submit" className={btnPrimary} disabled={busy}>
            {t("admin.setup.brand.save")}
          </button>
        </div>
      </Form>
      <Feedback data={actionData} intent="studio" />
    </Section>
  );
}
