import { Form } from "react-router";

import { useT } from "../../../i18n/use-t";
import type { SetupActionData, SetupViewData } from "./types";
import { btn, btnPrimary, Feedback, Section } from "./ui";

export function DriveSection({
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
    <Section title={t("admin.setup.section.drive")}>
      <p className="text-body">
        {data.mock
          ? t("admin.setup.drive.demo")
          : data.connected
            ? t("admin.setup.drive.connected")
            : t("admin.setup.drive.notConnected")}
      </p>
      <div className="flex flex-wrap gap-2">
        {data.mock ? (
          <button type="button" className={btn} disabled>
            {t("admin.setup.connect")}
          </button>
        ) : (
          <a
            href="/admin/google/connect"
            className={`${btnPrimary} inline-block`}
          >
            {data.connected
              ? t("admin.setup.reconnect")
              : t("admin.setup.connect")}
          </a>
        )}
        {data.connected && !data.mock && (
          <Form method="post">
            <input type="hidden" name="intent" value="disconnect" />
            <button type="submit" className={btn} disabled={busy}>
              {t("admin.setup.disconnect")}
            </button>
          </Form>
        )}
      </div>
      <Feedback data={actionData} intent="disconnect" />
    </Section>
  );
}
