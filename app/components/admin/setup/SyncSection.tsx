import { Form, useNavigation } from "react-router";

import { useFormat } from "../../../i18n/use-format";
import { useT } from "../../../i18n/use-t";
import { SyncSummary } from "./SyncSummary";
import type { SetupActionData, SetupViewData } from "./types";
import { btnPrimary, Feedback, Section } from "./ui";

export function SyncSection({
  data,
  actionData,
  busy,
}: {
  data: SetupViewData;
  actionData: SetupActionData | undefined;
  busy: boolean;
}) {
  const t = useT();
  const { dateTime, number } = useFormat();
  const nav = useNavigation();
  return (
    <Section title={t("admin.setup.section.sync")}>
      <p className="text-small text-grey-700">
        {data.lastSyncAt
          ? t("admin.status.lastSync", { time: dateTime(data.lastSyncAt) })
          : t("admin.status.neverSynced")}
      </p>
      {data.cacheWarm && (
        <p data-testid="cache-warm" className="text-small text-grey-700">
          {t("admin.setup.sync.cache", {
            warmed: number(data.cacheWarm.warmed),
            total: number(data.cacheWarm.total),
          })}
        </p>
      )}
      {data.lastError && (
        <p role="alert" className="text-small">
          {t("admin.setup.sync.lastError", {
            time: dateTime(data.lastError.at),
            message: data.lastError.message,
          })}
        </p>
      )}
      <Form method="post">
        <input type="hidden" name="intent" value="sync" />
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy && nav.formData?.get("intent") === "sync"
            ? t("admin.setup.sync.syncing")
            : t("admin.setup.sync.now")}
        </button>
      </Form>
      <Feedback data={actionData} intent="sync" />
      {actionData?.intent === "sync" && actionData.ok && actionData.result && (
        <SyncSummary result={actionData.result} />
      )}
    </Section>
  );
}
