import { useFormat } from "../../../i18n/use-format";
import { useT } from "../../../i18n/use-t";
import { DEVICE_KEYS } from "../../../lib/admin-activity";
import type { ActivityViewData } from "./types";

export function Breakdown({ data }: { data: ActivityViewData["breakdown"] }) {
  const t = useT();
  const { number } = useFormat();
  const groups = [
    ["countries", "admin.activity.breakdown.countries"],
    ["devices", "admin.activity.breakdown.devices"],
    ["browsers", "admin.activity.breakdown.browsers"],
    ["referrers", "admin.activity.breakdown.referrers"],
  ] as const;
  const label = (key: string, value: string) =>
    key === "devices" && Object.hasOwn(DEVICE_KEYS, value)
      ? t(DEVICE_KEYS[value]!)
      : value;
  return (
    <section aria-labelledby="breakdown-title" className="flex flex-col gap-3">
      <h2 id="breakdown-title" className="text-micro text-grey-700 uppercase">
        {t("admin.activity.breakdown.title")}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        {groups.map(([key, title]) => (
          <div key={key} className="border-grey-200 border p-4">
            <h3 className="text-micro text-grey-700 uppercase">{t(title)}</h3>
            {data[key].length === 0 ? (
              <p className="text-small text-grey-700 mt-2">
                {t("admin.activity.breakdown.empty")}
              </p>
            ) : (
              <ol className="text-small mt-2 flex flex-col gap-1">
                {data[key].map((e) => (
                  <li key={e.value} className="flex justify-between gap-3">
                    <span className="min-w-0 break-words">
                      {label(key, e.value)}
                    </span>
                    <span className="tabular-nums">{number(e.count)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
