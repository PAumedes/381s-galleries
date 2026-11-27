import { useEffect } from "react";
import { useFetcher } from "react-router";

import { formatBytes } from "../../../lib/format-bytes";
import { useT } from "../../../i18n/use-t";
import type { SetupActionData } from "./types";
import { btn, Feedback, Section } from "./ui";

type Sweep = NonNullable<SetupActionData["sweep"]>;

/** Hidden fields that carry a page's progress to the next request (also works without scripts). */
function Resume({ sweep }: { sweep: Sweep }) {
  return (
    <>
      <input
        type="hidden"
        name="intent"
        value={sweep.phase === "scan" ? "sweepScan" : "sweepDelete"}
      />
      {sweep.phase === "delete" && (
        <input type="hidden" name="confirm" value="1" />
      )}
      {sweep.cursor && (
        <input type="hidden" name="cursor" value={sweep.cursor} />
      )}
      <input type="hidden" name="totals" value={JSON.stringify(sweep.totals)} />
    </>
  );
}

/**
 * "Mantenimiento": the orphan cache sweep (T6.59). Every request handles one
 * bounded page; plain forms carry the cursor, so it works without scripts, and
 * with scripts the next page is posted automatically until the cursor runs out.
 */
export function SweepSection({
  actionData,
}: {
  actionData: SetupActionData | undefined;
}) {
  const t = useT();
  const fetcher = useFetcher<SetupActionData>();
  const own = (d: SetupActionData | undefined) =>
    d?.intent === "sweepScan" || d?.intent === "sweepDelete" ? d : undefined;
  const data = own(fetcher.data) ?? own(actionData);
  const sweep = data?.sweep;
  const running = !!data?.ok && !!sweep && sweep.cursor !== null;
  const idle = fetcher.state === "idle";

  useEffect(() => {
    if (!sweep || !running || !idle) return;
    const body: Record<string, string> = {
      intent: sweep.phase === "scan" ? "sweepScan" : "sweepDelete",
      cursor: sweep.cursor ?? "",
      totals: JSON.stringify(sweep.totals),
    };
    if (sweep.phase === "delete") body.confirm = "1";
    void fetcher.submit(body, { method: "post" });
    // fetcher is stable per render of the same data; the answer drives the loop.
  }, [data, sweep, running, idle]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = sweep?.totals;
  const scanFinished = sweep?.phase === "scan" && sweep.done;
  return (
    <Section title={t("admin.setup.section.sweep")} help="cleanup-what">
      <p className="text-small text-grey-600">{t("admin.setup.sweep.note")}</p>

      {running && sweep && totals && (
        <fetcher.Form method="post" className="flex flex-col gap-2">
          <Resume sweep={sweep} />
          <p role="status" className="text-small text-grey-700">
            {sweep.phase === "scan"
              ? t("admin.setup.sweep.progress", {
                  scanned: totals.scanned,
                  orphans: totals.orphans,
                })
              : t("admin.setup.sweep.deleting", { deleted: totals.deleted })}
          </p>
          <div>
            <button type="submit" className={btn} disabled={!idle}>
              {t(
                sweep.phase === "scan"
                  ? "admin.setup.sweep.continueScan"
                  : "admin.setup.sweep.continueDelete",
              )}
            </button>
          </div>
        </fetcher.Form>
      )}

      {!data?.ok && sweep && !sweep.done && sweep.cursor !== null && (
        <fetcher.Form method="post">
          <Resume sweep={sweep} />
          <button type="submit" className={btn} disabled={!idle}>
            {t(
              sweep.phase === "scan"
                ? "admin.setup.sweep.continueScan"
                : "admin.setup.sweep.continueDelete",
            )}
          </button>
        </fetcher.Form>
      )}

      {scanFinished && totals && (
        <>
          <p role="status" className="text-small text-grey-700">
            {totals.orphans > 0
              ? t("admin.setup.sweep.found", {
                  orphans: totals.orphans,
                  size: formatBytes(totals.bytes),
                  ignored: totals.ignored,
                  held: totals.held,
                })
              : t("admin.setup.sweep.none")}
          </p>
          {totals.orphans > 0 && (
            <fetcher.Form method="post" className="flex flex-col gap-2">
              <input type="hidden" name="intent" value="sweepDelete" />
              <label className="flex items-start gap-2 text-small">
                <input type="checkbox" name="confirm" value="1" required />
                {t("admin.setup.sweep.confirm")}
              </label>
              <div>
                <button type="submit" className={btn} disabled={!idle}>
                  {t("admin.setup.sweep.delete")}
                </button>
              </div>
            </fetcher.Form>
          )}
        </>
      )}

      {sweep?.phase === "delete" && sweep.done && totals && (
        <p role="status" className="text-small text-grey-700">
          {t("admin.setup.sweep.deleted", { deleted: totals.deleted })}
        </p>
      )}

      {!running && (
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="sweepScan" />
          <button type="submit" className={btn} disabled={!idle}>
            {t("admin.setup.sweep.scan")}
          </button>
        </fetcher.Form>
      )}
      {data && !data.ok && <Feedback data={data} intent={data.intent} />}
    </Section>
  );
}
